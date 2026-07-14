import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalizeClaudeConfigDir } from "./claudeConfigDir";

export function getProjectPath(workingDirectory: string) {
    const projectId = resolve(workingDirectory).replace(/[^a-zA-Z0-9-]/g, '-');
    // Canonicalize the account home so ~/relative/trailing-slash variants resolve
    // to one identical projects dir (M3). The unset/default case stays byte-identical:
    // canonicalize(join(homedir(),'.claude')) === join(homedir(),'.claude').
    const claudeConfigDir = canonicalizeClaudeConfigDir(process.env.CLAUDE_CONFIG_DIR) ?? join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects', projectId);
}