import type { Session } from './storageTypes';
import type { PermissionModeKey } from '@/components/PermissionModeSelector';
import { resolveClaudeConfigDir } from '@/components/claudeAccountOptions';

function isSandboxEnabled(metadata: Session['metadata'] | null | undefined): boolean {
    const sandbox = metadata?.sandbox;
    return !!sandbox && typeof sandbox === 'object' && (sandbox as { enabled?: unknown }).enabled === true;
}

export function resolveMessageModeMeta(
    session: Pick<Session, 'permissionMode' | 'modelMode' | 'claudeAccount' | 'metadata'>,
): { permissionMode: PermissionModeKey; model: string | null; claudeConfigDir: string | null } {
    const sandboxEnabled = isSandboxEnabled(session.metadata);
    const permissionMode: PermissionModeKey =
        session.permissionMode && session.permissionMode !== 'default'
            ? session.permissionMode
            : (sandboxEnabled ? 'bypassPermissions' : 'default');

    const modelMode = session.modelMode || 'default';
    const model = modelMode !== 'default' ? modelMode : null;

    // Config dir for the session's selected Claude account, or null when unset
    // (null → no CLAUDE_CONFIG_DIR override is sent; the CLI keeps the current account).
    const claudeConfigDir = resolveClaudeConfigDir(session.claudeAccount);

    return {
        permissionMode,
        model,
        claudeConfigDir,
    };
}
