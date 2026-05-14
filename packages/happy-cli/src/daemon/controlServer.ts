/**
 * HTTP control server for daemon management
 * Provides endpoints for listing sessions, stopping sessions, and daemon shutdown
 */

import fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { logger } from '@/ui/logger';
import { Metadata } from '@/api/types';
import { TrackedSession } from './types';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

/**
 * /list response schema version. Bumped from implicit-v1 (no schemaVersion
 * field) to v2 to expose codex tracking fields:
 *   - flavor:        BackendFlavor discriminator
 *   - codexThreadId: codex thread id once bound
 *   - cwd:           working directory (from session metadata)
 *   - tidPending:    true when a codex session is visible but tid not yet bound
 *
 * Consumers tolerating absence of schemaVersion treat the response as v1.
 * Optional fields ensure additive compatibility for hidden consumers
 * (happy-agent integration test, openclaw integration test, recovery script
 * jq filters).
 */
export const CONTROL_LIST_SCHEMA_VERSION = 2;

/**
 * Build a single `/list` row from a TrackedSession.
 *
 * Hook for `tidPending` provided by the daemon caller (codex sessions whose
 * tid has not yet been bound via /session-started). Caller passes
 * `pendingCodex` = set of happy session IDs in `pending` state from the codex
 * mapping module.
 */
export interface ListRow {
  startedBy: string;
  happySessionId: string;
  claudeSessionId?: string;
  pid: number;
  flavor?: 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw' | 'acp' | 'unknown';
  codexThreadId?: string;
  cwd?: string;
  tidPending?: boolean;
}

function pickFlavor(meta: Metadata | undefined): ListRow['flavor'] {
  const raw = meta?.flavor;
  switch (raw) {
    case 'claude':
    case 'codex':
    case 'gemini':
    case 'opencode':
    case 'openclaw':
    case 'acp':
      return raw;
    case undefined:
      return undefined;
    default:
      return 'unknown';
  }
}

function buildListRow(child: TrackedSession, pendingCodex: Set<string>): ListRow {
  const meta = child.happySessionMetadataFromLocalWebhook;
  const flavor = pickFlavor(meta);
  const codexThreadId = meta?.codexThreadId;
  const isCodex = flavor === 'codex';
  return {
    startedBy: child.startedBy,
    happySessionId: child.happySessionId!,
    claudeSessionId: meta?.claudeSessionId,
    pid: child.pid,
    flavor,
    codexThreadId,
    cwd: meta?.path,
    tidPending: isCodex
      ? (!codexThreadId || pendingCodex.has(child.happySessionId!))
      : undefined,
  };
}

type TypedApp = ReturnType<FastifyInstance['withTypeProvider']>;

const LIST_ROW_SCHEMA = z.object({
  startedBy: z.string(),
  happySessionId: z.string(),
  claudeSessionId: z.string().optional(),
  pid: z.number(),
  // v2 ADDITIVE optional fields (BA F4). 'flavor' enum mirrors BackendFlavor.
  flavor: z.enum(['claude', 'codex', 'gemini', 'opencode', 'openclaw', 'acp', 'unknown']).optional(),
  codexThreadId: z.string().optional(),
  cwd: z.string().optional(),
  tidPending: z.boolean().optional()
});

function registerListEndpoint(
  typed: TypedApp,
  getChildren: () => TrackedSession[],
  getPendingCodexSessionIds: (() => Set<string>) | undefined
): void {
  typed.post('/list', {
    schema: {
      response: {
        200: z.object({
          schemaVersion: z.literal(CONTROL_LIST_SCHEMA_VERSION).optional(),
          children: z.array(LIST_ROW_SCHEMA)
        })
      }
    }
  }, async () => {
    const children = getChildren();
    logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
    const pending = getPendingCodexSessionIds ? getPendingCodexSessionIds() : new Set<string>();
    return {
      schemaVersion: CONTROL_LIST_SCHEMA_VERSION,
      children: children
        .filter(child => child.happySessionId !== undefined)
        .map(child => buildListRow(child, pending))
    };
  });
}

export function startDaemonControlServer({
  getChildren,
  getPendingCodexSessionIds,
  stopSession,
  spawnSession,
  requestShutdown,
  onHappySessionWebhook
}: {
  getChildren: () => TrackedSession[];
  /**
   * Optional accessor returning the set of happy session IDs whose codex tid
   * binding is still in flight (codex-mapping.json state === 'pending').
   * Omitting it leaves `tidPending` always undefined for non-codex rows AND
   * derives codex `tidPending` purely from absence of `codexThreadId`.
   */
  getPendingCodexSessionIds?: () => Set<string>;
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata) => void;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post('/session-started', {
      schema: {
        body: z.object({ sessionId: z.string(), metadata: z.any() }),
        response: { 200: z.object({ status: z.literal('ok') }) }
      }
    }, async (request) => {
      const { sessionId, metadata } = request.body;
      logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);
      onHappySessionWebhook(sessionId, metadata);
      return { status: 'ok' as const };
    });

    registerListEndpoint(typed, getChildren, getPendingCodexSessionIds);

    // Stop specific session
    typed.post('/stop-session', {
      schema: {
        body: z.object({
          sessionId: z.string()
        }),
        response: {
          200: z.object({
            success: z.boolean()
          })
        }
      }
    }, async (request) => {
      const { sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
      const success = stopSession(sessionId);
      return { success };
    });

    // Spawn new session
    typed.post('/spawn-session', {
      schema: {
        body: z.object({
          directory: z.string(),
          sessionId: z.string().optional(),
          agent: z.enum(['claude', 'codex', 'gemini', 'openclaw']).optional(),
          environmentVariables: z.record(z.string(), z.string()).optional(),
        }),
        response: {
          200: z.object({
            success: z.boolean(),
            sessionId: z.string().optional(),
            approvedNewDirectoryCreation: z.boolean().optional()
          }),
          409: z.object({
            success: z.boolean(),
            requiresUserApproval: z.boolean().optional(),
            actionRequired: z.string().optional(),
            directory: z.string().optional()
          }),
          500: z.object({
            success: z.boolean(),
            error: z.string().optional()
          })
        }
      }
    }, async (request, reply) => {
      const { directory, sessionId, agent, environmentVariables } = request.body;

      logger.debug(`[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || 'new'}, agent=${agent || 'default'}`);
      const result = await spawnSession({ directory, sessionId, agent, environmentVariables });

      switch (result.type) {
        case 'success':
          // Check if sessionId exists, if not return error
          if (!result.sessionId) {
            reply.code(500);
            return {
              success: false,
              error: 'Failed to spawn session: no session ID returned'
            };
          }
          return {
            success: true,
            sessionId: result.sessionId,
            approvedNewDirectoryCreation: true
          };
        
        case 'requestToApproveDirectoryCreation':
          reply.code(409); // Conflict - user input needed
          return { 
            success: false,
            requiresUserApproval: true,
            actionRequired: 'CREATE_DIRECTORY',
            directory: result.directory
          };
        
        case 'error':
          reply.code(500);
          return { 
            success: false,
            error: result.errorMessage
          };
      }
    });

    // Stop daemon
    typed.post('/stop', {
      schema: {
        response: {
          200: z.object({
            status: z.string()
          })
        }
      }
    }, async () => {
      logger.debug('[CONTROL SERVER] Stop daemon request received');

      // Give time for response to arrive
      setTimeout(() => {
        logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
        requestShutdown();
      }, 50);

      return { status: 'stopping' };
    });

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        throw err;
      }

      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        }
      });
    });
  });
}
