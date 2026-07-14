import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalizeClaudeConfigDir, deriveResumeSeed, seedClaudeConfigDirFromEnv } from './utils/claudeConfigDir';

const runClaudeSource = readFileSync(resolve('src/claude/runClaude.ts'), 'utf-8');

describe('runClaude startup seed (M2 / AC4)', () => {
    it('seedClaudeConfigDirFromEnv seeds sticky + overlay from the canonical env; unset is a no-op', () => {
        const A = '/root/.happy-dev-a/.claude/';
        expect(seedClaudeConfigDirFromEnv({ CLAUDE_CONFIG_DIR: A })).toEqual({
            sticky: canonicalizeClaudeConfigDir(A),
            overlay: canonicalizeClaudeConfigDir(A),
        });
        expect(seedClaudeConfigDirFromEnv({})).toEqual({ sticky: undefined, overlay: undefined });
    });

    it('runClaude invokes seedClaudeConfigDirFromEnv and applies sticky + overlay BEFORE the message queue/loop', () => {
        const seedIdx = runClaudeSource.indexOf('seedClaudeConfigDirFromEnv(process.env)');
        const overlayIdx = runClaudeSource.indexOf('CLAUDE_CONFIG_DIR: claudeConfigDirSeed.overlay');
        const stickyIdx = runClaudeSource.indexOf('claudeConfigDirSeed.sticky');
        const queueIdx = runClaudeSource.indexOf('new MessageQueue2');
        expect(seedIdx).toBeGreaterThan(-1);
        expect(overlayIdx).toBeGreaterThan(-1);
        expect(stickyIdx).toBeGreaterThan(-1);
        expect(seedIdx).toBeLessThan(queueIdx); // seed before the queue/loop
        expect(overlayIdx).toBeLessThan(queueIdx);
    });
});

describe('runClaude resume metadata seed (M5b / AC11)', () => {
    it('deriveResumeSeed derives claudeSessionId + canonical currentClaudeConfigDir on --resume; {} otherwise', () => {
        const A = '/root/.happy-dev-a/.claude/';
        expect(deriveResumeSeed(['claude', '--resume', '93a9705e-bc6a-406d-8dce-8acc014dedbd'], { CLAUDE_CONFIG_DIR: A }))
            .toEqual({ claudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd', currentClaudeConfigDir: canonicalizeClaudeConfigDir(A) });
        expect(deriveResumeSeed(['claude', '--started-by', 'daemon'], { CLAUDE_CONFIG_DIR: A })).toEqual({});
    });

    it('runClaude merges deriveResumeSeed(...) into the initial metadata BEFORE getOrCreateSession', () => {
        const deriveIdx = runClaudeSource.indexOf('deriveResumeSeed(options.claudeArgs, process.env)');
        const spreadIdx = runClaudeSource.indexOf('...resumeSeed');
        const getOrCreateIdx = runClaudeSource.indexOf('getOrCreateSession(');
        expect(deriveIdx).toBeGreaterThan(-1);
        expect(spreadIdx).toBeGreaterThan(-1);
        expect(deriveIdx).toBeLessThan(spreadIdx);
        expect(spreadIdx).toBeLessThan(getOrCreateIdx); // binding seeded before the session is created
    });
});
