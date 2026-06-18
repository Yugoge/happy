import { createEnvelope, type SessionEnvelope } from '@slopus/happy-wire';
import { trimIdent } from '@/utils/trimIdent';
import { notifyDaemonOfCodexTid } from '@/codex/notifyDaemonOfCodexTid';

type ResumeThreadClient = {
    resumeThread: (opts: {
        threadId: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
    }) => Promise<{ threadId: string; model: string }>;
};

type ResumeThreadSession = {
    /**
     * Happy session ID. Required for M1 daemon re-notify so the daemon's
     * tracked-session row + codex-mapping.json learn the RESULT codex tid.
     * codexAppServerClient.ts:856 reassigns _threadId, so the returned tid
     * can differ from the requested tid.
     */
    sessionId?: string;
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    /**
     * Real session-protocol channel (apiSession.ts:461), already used by the
     * live codex loop at runCodex.ts:662. The same full session is passed to
     * resumeExistingThread at runCodex.ts:684, so structural typing satisfies
     * this widened type with NO runCodex.ts edit. The resume notice is emitted
     * as a genuine t:'service' envelope so the app renders it as a gray system
     * notification rather than a normal assistant message.
     */
    sendSessionProtocolMessage: (envelope: SessionEnvelope) => void;
};

type ResumeThreadMessageBuffer = {
    addMessage: (message: string, type: 'status') => void;
};

/**
 * M1 hook for the resume path. Updates session metadata with the RESULT tid
 * (not requested tid) and fires the daemon re-notify so /list + mapping file
 * learn the binding. Idempotent.
 */
function bindResumedTid(session: ResumeThreadSession, tid: string): void {
    session.updateMetadata((currentMetadata) => {
        const updated = { ...currentMetadata, codexThreadId: tid };
        if (session.sessionId) {
            notifyDaemonOfCodexTid(session.sessionId, tid, updated);
        }
        return updated;
    });
}

export async function resumeExistingThread(opts: {
    client: ResumeThreadClient;
    session: ResumeThreadSession;
    messageBuffer: ResumeThreadMessageBuffer;
    threadId: string;
    cwd: string;
    mcpServers: Record<string, unknown>;
}): Promise<{ threadId: string; model: string }> {
    try {
        const resumedThread = await opts.client.resumeThread({
            threadId: opts.threadId,
            cwd: opts.cwd,
            mcpServers: opts.mcpServers,
        });
        bindResumedTid(opts.session, resumedThread.threadId);
        opts.messageBuffer.addMessage(`Resumed thread ${trimIdent(resumedThread.threadId)}`, 'status');
        // Emit the resume notice as a genuine t:'service' envelope (role 'agent'
        // per sessionProtocol.ts:120) so the app normalizes it to a gray system
        // notification. REPLACES the legacy sendSessionEvent({type:'message'})
        // emission — emitting both would render two app-visible notices.
        opts.session.sendSessionProtocolMessage(
            createEnvelope('agent', { t: 'service', text: `Resumed Codex thread ${resumedThread.threadId}` }),
        );
        return resumedThread;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resume Codex thread ${opts.threadId}: ${reason}`);
    }
}
