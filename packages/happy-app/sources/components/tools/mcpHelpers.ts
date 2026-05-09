// Cycle 6 (#17): predicate identifying registered MCP-namespace tools that
// must render as chip-only inline (no subtitle leaks). Covers BOTH the
// `mcp__*` server-prefixed names AND the `functions.*` MCP-related entries
// that codex review identified as duplicate subtitle leakers.
const MCP_FUNCTION_TOOLS: ReadonlySet<string> = new Set([
    'functions.list_mcp_resources',
    'functions.list_mcp_resource_templates',
    'functions.read_mcp_resource',
]);

export function isMcpInlineChipOnlyTool(toolName: string): boolean {
    if (!toolName) return false;
    if (toolName.startsWith('mcp__')) return true;
    return MCP_FUNCTION_TOOLS.has(toolName);
}
