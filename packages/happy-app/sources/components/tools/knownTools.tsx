import { Metadata } from '@/sync/storageTypes';
import { ToolCall, Message } from '@/sync/typesMessage';
import { resolvePath } from '@/utils/pathUtils';
import { stringifyToolCommand } from '@/utils/toolCommand';
import { extractAttachmentSummary, attachmentHasRenderableImagePreview, extractPlanItems, summarizePlanItems, isCodexSubagentControlTool } from '@/utils/codexToolRendering';
import * as z from 'zod';
import { Ionicons, Octicons } from '@expo/vector-icons';
import React from 'react';
import { t } from '@/text';

// Icon factory functions
const ICON_TASK = (size: number = 24, color: string = '#000') => <Octicons name="rocket" size={size} color={color} />;
const ICON_TERMINAL = (size: number = 24, color: string = '#000') => <Octicons name="terminal" size={size} color={color} />;
const ICON_SEARCH = (size: number = 24, color: string = '#000') => <Octicons name="search" size={size} color={color} />;
const ICON_READ = (size: number = 24, color: string = '#000') => <Octicons name="eye" size={size} color={color} />;
const ICON_EDIT = (size: number = 24, color: string = '#000') => <Octicons name="file-diff" size={size} color={color} />;
const ICON_WEB = (size: number = 24, color: string = '#000') => <Ionicons name="globe-outline" size={size} color={color} />;
const ICON_EXIT = (size: number = 24, color: string = '#000') => <Ionicons name="exit-outline" size={size} color={color} />;
const ICON_TODO = (size: number = 24, color: string = '#000') => <Ionicons name="bulb-outline" size={size} color={color} />;
const ICON_REASONING = (size: number = 24, color: string = '#000') => <Octicons name="light-bulb" size={size} color={color} />;
const ICON_QUESTION = (size: number = 24, color: string = '#000') => <Ionicons name="help-circle-outline" size={size} color={color} />;
const ICON_APPLY = (size: number = 24, color: string = '#000') => <Ionicons name="checkmark-circle-outline" size={size} color={color} />;
const ICON_CLOCK = (size: number = 24, color: string = '#000') => <Ionicons name="timer-outline" size={size} color={color} />;
const ICON_LINK = (size: number = 24, color: string = '#000') => <Ionicons name="link-outline" size={size} color={color} />;
const ICON_WEATHER = (size: number = 24, color: string = '#000') => <Ionicons name="partly-sunny-outline" size={size} color={color} />;
const ICON_HAND = (size: number = 24, color: string = '#000') => <Ionicons name="hand-left-outline" size={size} color={color} />;
const ICON_IMAGE = (size: number = 24, color: string = '#000') => <Ionicons name="image-outline" size={size} color={color} />;
const ICON_FINANCE = (size: number = 24, color: string = '#000') => <Ionicons name="trending-up-outline" size={size} color={color} />;
const ICON_SPORTS = (size: number = 24, color: string = '#000') => <Ionicons name="football-outline" size={size} color={color} />;
const ICON_SCAN = (size: number = 24, color: string = '#000') => <Ionicons name="scan-outline" size={size} color={color} />;

function getPatchFiles(input: any): string[] {
    if (input?.changes && typeof input.changes === 'object' && !Array.isArray(input.changes)) {
        return Object.keys(input.changes);
    }
    if (input?.fileChanges && typeof input.fileChanges === 'object' && !Array.isArray(input.fileChanges)) {
        return Object.keys(input.fileChanges);
    }
    return [];
}

function codexToolStateStatus(opts: { metadata: Metadata | null, tool: ToolCall }): string | null {
    if (opts.tool.state === 'completed') return 'completed';
    if (opts.tool.state === 'error') {
        return typeof opts.tool.result?.status === 'string' ? opts.tool.result.status : 'error';
    }
    return null;
}

const taskLikeTool = {
    title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
        if (opts.tool.input && opts.tool.input.description && typeof opts.tool.input.description === 'string') {
            return opts.tool.input.description;
        }
        return t('tools.names.task');
    },
    icon: ICON_TASK,
    isMutable: true,
    minimal: (opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => {
        const messages = opts.messages || [];
        for (let m of messages) {
            if (m.kind === 'tool-call'
                && (m.tool.state === 'running' || m.tool.state === 'completed' || m.tool.state === 'error')) {
                return false;
            }
        }
        return true;
    },
    input: z.object({
        prompt: z.string().describe('The task for the agent to perform'),
        subagent_type: z.string().optional().describe('The type of specialized agent to use')
    }).partial().passthrough()
};

export const knownTools = {
    'Task': taskLikeTool,
    'Agent': taskLikeTool,
    'Bash': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.description) {
                return opts.tool.description;
            }
            return t('tools.names.terminal');
        },
        icon: ICON_TERMINAL,
        minimal: true,
        hideDefaultError: true,
        isMutable: true,
        input: z.object({
            command: z.string().describe('The command to execute'),
            timeout: z.number().optional().describe('Timeout in milliseconds (max 600000)')
        }),
        result: z.object({
            stderr: z.string(),
            stdout: z.string(),
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.command === 'string') {
                const cmd = opts.tool.input.command;
                // Extract just the command name for common commands
                const firstWord = cmd.split(' ')[0];
                if (['cd', 'ls', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'npm', 'yarn', 'git'].includes(firstWord)) {
                    return t('tools.desc.terminalCmd', { cmd: firstWord });
                }
                // For other commands, show truncated version
                const truncated = cmd.length > 20 ? cmd.substring(0, 20) + '...' : cmd;
                return t('tools.desc.terminalCmd', { cmd: truncated });
            }
            return t('tools.names.terminal');
        },
        extractSubtitle: () => null
    },
    'Glob': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.pattern === 'string') {
                return opts.tool.input.pattern;
            }
            return t('tools.names.searchFiles');
        },
        icon: ICON_SEARCH,
        minimal: true,
        input: z.object({
            pattern: z.string().describe('The glob pattern to match files against'),
            path: z.string().optional().describe('The directory to search in')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.pattern === 'string') {
                return t('tools.desc.searchPattern', { pattern: opts.tool.input.pattern });
            }
            return t('tools.names.search');
        }
    },
    'Grep': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.pattern === 'string') {
                return `grep(pattern: ${opts.tool.input.pattern})`;
            }
            return 'Search Content';
        },
        icon: ICON_READ,
        minimal: true,
        input: z.object({
            pattern: z.string().describe('The regular expression pattern to search for'),
            path: z.string().optional().describe('File or directory to search in'),
            output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
            '-n': z.boolean().optional().describe('Show line numbers'),
            '-i': z.boolean().optional().describe('Case insensitive search'),
            '-A': z.number().optional().describe('Lines to show after match'),
            '-B': z.number().optional().describe('Lines to show before match'),
            '-C': z.number().optional().describe('Lines to show before and after match'),
            glob: z.string().optional().describe('Glob pattern to filter files'),
            type: z.string().optional().describe('File type to search'),
            head_limit: z.number().optional().describe('Limit output to first N lines/entries'),
            multiline: z.boolean().optional().describe('Enable multiline mode')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.pattern === 'string') {
                const pattern = opts.tool.input.pattern.length > 20
                    ? opts.tool.input.pattern.substring(0, 20) + '...'
                    : opts.tool.input.pattern;
                return `Search(pattern: ${pattern})`;
            }
            return 'Search';
        }
    },
    'LS': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.path === 'string') {
                return resolvePath(opts.tool.input.path, opts.metadata);
            }
            return t('tools.names.listFiles');
        },
        icon: ICON_SEARCH,
        minimal: true,
        input: z.object({
            path: z.string().describe('The absolute path to the directory to list'),
            ignore: z.array(z.string()).optional().describe('List of glob patterns to ignore')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.path === 'string') {
                const path = resolvePath(opts.tool.input.path, opts.metadata);
                const basename = path.split('/').pop() || path;
                return t('tools.desc.searchPath', { basename });
            }
            return t('tools.names.search');
        }
    },
    'ExitPlanMode': {
        title: t('tools.names.planProposal'),
        icon: ICON_EXIT,
        input: z.object({
            plan: z.string().describe('The plan you came up with')
        }).partial().passthrough()
    },
    'exit_plan_mode': {
        title: t('tools.names.planProposal'),
        icon: ICON_EXIT,
        input: z.object({
            plan: z.string().describe('The plan you came up with')
        }).partial().passthrough()
    },
    'Read': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                return path;
            }
            // Gemini uses 'locations' array with 'path' field
            if (opts.tool.input.locations && Array.isArray(opts.tool.input.locations) && opts.tool.input.locations[0]?.path) {
                const path = resolvePath(opts.tool.input.locations[0].path, opts.metadata);
                return path;
            }
            return t('tools.names.readFile');
        },
        // B05 (bidirectional): relax header-only minimal ONLY when the Read result
        // carries an actually-renderable image preview (so ReadView renders it).
        // Text reads — and image-extension reads with no preview — stay minimal=true
        // → header-only, unchanged (no empty body; codex F3).
        minimal: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return !attachmentHasRenderableImagePreview(extractAttachmentSummary(opts.tool.input, opts.tool.result));
        },
        icon: ICON_READ,
        input: z.object({
            file_path: z.string().describe('The absolute path to the file to read'),
            limit: z.number().optional().describe('The number of lines to read'),
            offset: z.number().optional().describe('The line number to start reading from'),
            // Gemini format
            items: z.array(z.any()).optional(),
            locations: z.array(z.object({ path: z.string() }).passthrough()).optional()
        }).partial().passthrough(),
        result: z.object({
            file: z.object({
                filePath: z.string().describe('The absolute path to the file to read'),
                content: z.string().describe('The content of the file'),
                numLines: z.number().describe('The number of lines in the file'),
                startLine: z.number().describe('The line number to start reading from'),
                totalLines: z.number().describe('The total number of lines in the file')
            }).passthrough().optional()
        }).partial().passthrough()
    },
    // Gemini uses lowercase 'read'
    'read': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Gemini uses 'locations' array with 'path' field
            if (opts.tool.input.locations && Array.isArray(opts.tool.input.locations) && opts.tool.input.locations[0]?.path) {
                const path = resolvePath(opts.tool.input.locations[0].path, opts.metadata);
                return path;
            }
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                return path;
            }
            return t('tools.names.readFile');
        },
        minimal: true,
        icon: ICON_READ,
        input: z.object({
            items: z.array(z.any()).optional(),
            locations: z.array(z.object({ path: z.string() }).passthrough()).optional(),
            file_path: z.string().optional()
        }).partial().passthrough()
    },
    'Edit': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                return path;
            }
            return t('tools.names.editFile');
        },
        icon: ICON_EDIT,
        isMutable: true,
        input: z.object({
            file_path: z.string().describe('The absolute path to the file to modify'),
            old_string: z.string().describe('The text to replace'),
            new_string: z.string().describe('The text to replace it with'),
            replace_all: z.boolean().optional().default(false).describe('Replace all occurrences')
        }).partial().passthrough()
    },
    'MultiEdit': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                const editCount = Array.isArray(opts.tool.input.edits) ? opts.tool.input.edits.length : 0;
                if (editCount > 1) {
                    return t('tools.desc.multiEditEdits', { path, count: editCount });
                }
                return path;
            }
            return t('tools.names.editFile');
        },
        icon: ICON_EDIT,
        isMutable: true,
        input: z.object({
            file_path: z.string().describe('The absolute path to the file to modify'),
            edits: z.array(z.object({
                old_string: z.string().describe('The text to replace'),
                new_string: z.string().describe('The text to replace it with'),
                replace_all: z.boolean().optional().default(false).describe('Replace all occurrences')
            })).describe('Array of edit operations')
        }).partial().passthrough(),
        extractStatus: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                const editCount = Array.isArray(opts.tool.input.edits) ? opts.tool.input.edits.length : 0;
                if (editCount > 0) {
                    return t('tools.desc.multiEditEdits', { path, count: editCount });
                }
                return path;
            }
            return null;
        }
    },
    'Write': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.file_path === 'string') {
                const path = resolvePath(opts.tool.input.file_path, opts.metadata);
                return path;
            }
            return t('tools.names.writeFile');
        },
        icon: ICON_EDIT,
        isMutable: true,
        input: z.object({
            file_path: z.string().describe('The absolute path to the file to write'),
            content: z.string().describe('The content to write to the file')
        }).partial().passthrough()
    },
    'WebFetch': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.url === 'string') {
                try {
                    const url = new URL(opts.tool.input.url);
                    return url.hostname;
                } catch {
                    return t('tools.names.fetchUrl');
                }
            }
            return t('tools.names.fetchUrl');
        },
        icon: ICON_WEB,
        minimal: true,
        input: z.object({
            url: z.string().url().describe('The URL to fetch content from'),
            prompt: z.string().describe('The prompt to run on the fetched content')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.url === 'string') {
                try {
                    const url = new URL(opts.tool.input.url);
                    return t('tools.desc.fetchUrlHost', { host: url.hostname });
                } catch {
                    return t('tools.names.fetchUrl');
                }
            }
            return 'Fetch URL';
        }
    },
    'NotebookRead': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.notebook_path === 'string') {
                const path = resolvePath(opts.tool.input.notebook_path, opts.metadata);
                return path;
            }
            return t('tools.names.readNotebook');
        },
        icon: ICON_READ,
        minimal: true,
        input: z.object({
            notebook_path: z.string().describe('The absolute path to the Jupyter notebook file'),
            cell_id: z.string().optional().describe('The ID of a specific cell to read')
        }).partial().passthrough()
    },
    'NotebookEdit': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.notebook_path === 'string') {
                const path = resolvePath(opts.tool.input.notebook_path, opts.metadata);
                return path;
            }
            return t('tools.names.editNotebook');
        },
        icon: ICON_EDIT,
        isMutable: true,
        input: z.object({
            notebook_path: z.string().describe('The absolute path to the notebook file'),
            new_source: z.string().describe('The new source for the cell'),
            cell_id: z.string().optional().describe('The ID of the cell to edit'),
            cell_type: z.enum(['code', 'markdown']).optional().describe('The type of the cell'),
            edit_mode: z.enum(['replace', 'insert', 'delete']).optional().describe('The type of edit to make')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.notebook_path === 'string') {
                const path = resolvePath(opts.tool.input.notebook_path, opts.metadata);
                const mode = opts.tool.input.edit_mode || 'replace';
                return t('tools.desc.editNotebookMode', { path, mode });
            }
            return t('tools.names.editNotebook');
        }
    },
    'TodoWrite': {
        title: t('tools.names.todoList'),
        icon: ICON_TODO,
        noStatus: true,
        minimal: (opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => {
            // Check if there are todos in the input
            if (opts.tool.input?.todos && Array.isArray(opts.tool.input.todos) && opts.tool.input.todos.length > 0) {
                return false; // Has todos, show expanded
            }
            
            // Check if there are todos in the result
            if (opts.tool.result?.newTodos && Array.isArray(opts.tool.result.newTodos) && opts.tool.result.newTodos.length > 0) {
                return false; // Has todos, show expanded
            }
            
            return true; // No todos, render as minimal
        },
        input: z.object({
            todos: z.array(z.object({
                content: z.string().describe('The todo item content'),
                status: z.enum(['pending', 'in_progress', 'completed']).describe('The status of the todo'),
                priority: z.enum(['high', 'medium', 'low']).optional().describe('The priority of the todo'),
                id: z.string().optional().describe('Unique identifier for the todo')
            }).passthrough()).describe('The updated todo list')
        }).partial().passthrough(),
        result: z.object({
            oldTodos: z.array(z.object({
                content: z.string().describe('The todo item content'),
                status: z.enum(['pending', 'in_progress', 'completed']).describe('The status of the todo'),
                priority: z.enum(['high', 'medium', 'low']).optional().describe('The priority of the todo'),
                id: z.string().describe('Unique identifier for the todo')
            }).passthrough()).describe('The old todo list'),
            newTodos: z.array(z.object({
                content: z.string().describe('The todo item content'),
                status: z.enum(['pending', 'in_progress', 'completed']).describe('The status of the todo'),
                priority: z.enum(['high', 'medium', 'low']).optional().describe('The priority of the todo'),
                id: z.string().describe('Unique identifier for the todo')
            }).passthrough()).describe('The new todo list')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (Array.isArray(opts.tool.input.todos)) {
                const count = opts.tool.input.todos.length;
                return t('tools.desc.todoListCount', { count });
            }
            return t('tools.names.todoList');
        },
    },
    'WebSearch': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.query === 'string') {
                return opts.tool.input.query;
            }
            return t('tools.names.webSearch');
        },
        icon: ICON_WEB,
        minimal: true,
        input: z.object({
            query: z.string().min(2).describe('The search query to use'),
            allowed_domains: z.array(z.string()).optional().describe('Only include results from these domains'),
            blocked_domains: z.array(z.string()).optional().describe('Never include results from these domains')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (typeof opts.tool.input.query === 'string') {
                const query = opts.tool.input.query.length > 30
                    ? opts.tool.input.query.substring(0, 30) + '...'
                    : opts.tool.input.query;
                return t('tools.desc.webSearchQuery', { query });
            }
            return t('tools.names.webSearch');
        }
    },
    'CodexBash': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const parsedCmd = opts.tool.input?.parsed_cmd;
            if (Array.isArray(parsedCmd) && parsedCmd.length === 1) {
                const cmd = parsedCmd[0];
                // Read branch: show the file path being read
                if (cmd.type === 'read' && cmd.name) {
                    return resolvePath(cmd.name, opts.metadata);
                }
                // Bash/unknown branch: show the command string as description (AC4)
                if ((cmd.type === 'bash' || cmd.type === 'unknown' || !cmd.type) && cmd.cmd) {
                    const desc = cmd.cmd;
                    return desc.length > 60 ? desc.substring(0, 60) + '…' : desc;
                }
            }
            // Fallback only when parsedCmd is absent/empty: show the raw command (AC4)
            if (!Array.isArray(parsedCmd) || parsedCmd.length === 0) {
                const rawCmd = opts.tool.input?.command;
                if (typeof rawCmd === 'string' && rawCmd) {
                    return rawCmd.length > 60 ? rawCmd.substring(0, 60) + '…' : rawCmd;
                }
            }
            return t('tools.names.terminal');
        },
        icon: ICON_TERMINAL,
        minimal: (opts: { tool: ToolCall }) => {
            // Return false for bash/unknown commands so the flat inline body renders (B03/M6).
            const parsedCmd = opts.tool.input?.parsed_cmd;
            if (Array.isArray(parsedCmd) && parsedCmd.length > 0) {
                const type = parsedCmd[0].type;
                if (type === 'bash' || type === 'unknown' || !type) return false;
                // Read/write are compact — their view returns early with iconRow anyway
                return true;
            }
            // No parsed_cmd: if raw command exists, render inline (it's a bash call)
            if (opts.tool.input?.command) return false;
            return true;
        },
        hideDefaultError: true,
        isMutable: true,
        input: z.object({
            command: z.union([z.string(), z.array(z.string())]).describe('The command to execute'),
            cwd: z.string().optional().describe('Current working directory'),
            parsed_cmd: z.array(z.object({
                type: z.string().describe('Type of parsed command (read, write, bash, etc.)'),
                cmd: z.string().optional().describe('The command string'),
                name: z.string().optional().describe('File name or resource name')
            }).passthrough()).optional().describe('Parsed command information')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // For single read commands, show the actual command
            if (opts.tool.input?.parsed_cmd && 
                Array.isArray(opts.tool.input.parsed_cmd) && 
                opts.tool.input.parsed_cmd.length === 1 &&
                opts.tool.input.parsed_cmd[0].type === 'read') {
                const parsedCmd = opts.tool.input.parsed_cmd[0];
                if (parsedCmd.cmd) {
                    // Show the command but truncate if too long
                    const cmd = parsedCmd.cmd;
                    return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
                }
            }
            return null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Provide a description based on the parsed command type
            if (opts.tool.input?.parsed_cmd && 
                Array.isArray(opts.tool.input.parsed_cmd) && 
                opts.tool.input.parsed_cmd.length === 1) {
                const parsedCmd = opts.tool.input.parsed_cmd[0];
                if (parsedCmd.type === 'read' && parsedCmd.name) {
                    // For single read commands, show "Reading" as simple description
                    // The file path is already in the title
                    const path = resolvePath(parsedCmd.name, opts.metadata);
                    const basename = path.split('/').pop() || path;
                    return t('tools.desc.readingFile', { file: basename });
                } else if (parsedCmd.type === 'write' && parsedCmd.name) {
                    const path = resolvePath(parsedCmd.name, opts.metadata);
                    const basename = path.split('/').pop() || path;
                    return t('tools.desc.writingFile', { file: basename });
                }
            }
            return t('tools.names.terminal');
        }
    },
    'CodexReasoning': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        },
        icon: ICON_REASONING,
        hidden: true,
        minimal: true,
        input: z.object({
            title: z.string().describe('The title of the reasoning')
        }).partial().passthrough(),
        result: z.object({
            content: z.string().describe('The reasoning content'),
            status: z.enum(['completed', 'in_progress', 'error']).optional().describe('The status of the reasoning')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        }
    },
    'GeminiReasoning': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        },
        icon: ICON_REASONING,
        hidden: true,
        minimal: true,
        input: z.object({
            title: z.string().describe('The title of the reasoning')
        }).partial().passthrough(),
        result: z.object({
            content: z.string().describe('The reasoning content'),
            status: z.enum(['completed', 'in_progress', 'canceled']).optional().describe('The status of the reasoning')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        }
    },
    'think': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        },
        icon: ICON_REASONING,
        hidden: true,
        minimal: true,
        input: z.object({
            title: z.string().optional().describe('The title of the thinking'),
            items: z.array(z.any()).optional().describe('Items to think about'),
            locations: z.array(z.any()).optional().describe('Locations to consider')
        }).partial().passthrough(),
        result: z.object({
            content: z.string().optional().describe('The reasoning content'),
            text: z.string().optional().describe('The reasoning text'),
            status: z.enum(['completed', 'in_progress', 'canceled']).optional().describe('The status')
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.title && typeof opts.tool.input.title === 'string') {
                return opts.tool.input.title;
            }
            return t('tools.names.reasoning');
        }
    },
    'change_title': {
        title: 'Change Title',
        icon: ICON_EDIT,
        hidden: true,
        minimal: true,
        noStatus: true,
        input: z.object({
            title: z.string().optional().describe('New session title')
        }).partial().passthrough(),
        result: z.object({}).partial().passthrough()
    },
    // Claude wire name alias for happy MCP change_title (Codex/Gemini wire name 'change_title' above).
    // §5.15 Phase B: hidden alias prevents raw fallback card in Claude sessions.
    'mcp__happy__change_title': {
        title: 'Change Title',
        icon: ICON_EDIT,
        hidden: true,
        minimal: true,
        noStatus: true,
        input: z.object({
            title: z.string().optional().describe('New session title')
        }).partial().passthrough(),
        result: z.object({}).partial().passthrough()
    },
    // Gemini internal tools - should be hidden (minimal)
    'search': {
        title: t('tools.names.search'),
        icon: ICON_SEARCH,
        minimal: true,
        input: z.object({
            items: z.array(z.any()).optional(),
            locations: z.array(z.any()).optional()
        }).partial().passthrough()
    },
    'edit': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Gemini sends data in nested structure, try multiple locations
            let filePath: string | undefined;
            
            // 1. Check toolCall.content[0].path
            if (opts.tool.input?.toolCall?.content?.[0]?.path) {
                filePath = opts.tool.input.toolCall.content[0].path;
            }
            // 2. Check toolCall.title (has nice "Writing to ..." format)
            else if (opts.tool.input?.toolCall?.title) {
                return opts.tool.input.toolCall.title;
            }
            // 3. Check input[0].path (array format)
            else if (Array.isArray(opts.tool.input?.input) && opts.tool.input.input[0]?.path) {
                filePath = opts.tool.input.input[0].path;
            }
            // 4. Check direct path field
            else if (typeof opts.tool.input?.path === 'string') {
                filePath = opts.tool.input.path;
            }
            
            if (filePath) {
                return resolvePath(filePath, opts.metadata);
            }
            return t('tools.names.editFile');
        },
        icon: ICON_EDIT,
        isMutable: true,
        input: z.object({
            path: z.string().describe('The file path to edit'),
            oldText: z.string().describe('The text to replace'),
            newText: z.string().describe('The new text'),
            type: z.string().optional().describe('Type of edit (diff)')
        }).partial().passthrough()
    },
    'shell': {
        title: t('tools.names.terminal'),
        icon: ICON_TERMINAL,
        minimal: true,
        isMutable: true,
        input: z.object({}).partial().passthrough()
    },
    'execute': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Gemini sends nice title in toolCall.title
            if (opts.tool.input?.toolCall?.title) {
                // Title is like "rm file.txt [cwd /path] (description)"
                // Extract just the command part before [
                const fullTitle = opts.tool.input.toolCall.title;
                const bracketIdx = fullTitle.indexOf(' [');
                if (bracketIdx > 0) {
                    return fullTitle.substring(0, bracketIdx);
                }
                return fullTitle;
            }
            return t('tools.names.terminal');
        },
        icon: ICON_TERMINAL,
        isMutable: true,
        minimal: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input;
            const title = input?.toolCall?.title;
            if (typeof title === 'string' && title.trim().length > 0) {
                return false;
            }

            const command = input?.command;
            if (typeof command === 'string' && command.trim().length > 0) {
                return false;
            }
            if (Array.isArray(command) && command.some((part) => typeof part === 'string' && part.trim().length > 0)) {
                return false;
            }

            // No command arguments available: keep terminal tool in compact form.
            return true;
        },
        input: z.object({}).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Extract description from parentheses at the end
            if (opts.tool.input?.toolCall?.title) {
                const title = opts.tool.input.toolCall.title;
                const parenMatch = title.match(/\(([^)]+)\)$/);
                if (parenMatch) {
                    return parenMatch[1];
                }
            }
            return null;
        }
    },
    'CodexPatch': {
        title: (opts: { tool: ToolCall; metadata: Metadata | null }) => {
            const files = getPatchFiles(opts.tool.input);
            if (files.length === 1) {
                const path = resolvePath(files[0], opts.metadata);
                return path.split('/').pop() || path;
            }
            if (files.length > 1) {
                return t('tools.desc.modifyingFiles', { count: files.length });
            }
            return t('tools.names.applyChanges');
        },
        icon: ICON_EDIT,
        minimal: false,
        hideDefaultError: true,
        input: z.object({
            auto_approved: z.boolean().optional().describe('Whether changes were auto-approved'),
            changes: z.record(z.string(), z.object({
                diff: z.string().optional(),
                kind: z.object({
                    type: z.string().optional(),
                    move_path: z.string().nullable().optional()
                }).optional(),
                add: z.object({
                    content: z.string()
                }).optional(),
                modify: z.object({
                    old_content: z.string(),
                    new_content: z.string()
                }).optional(),
                delete: z.object({
                    content: z.string()
                }).optional()
            }).passthrough()).describe('File changes to apply')
        }).partial().passthrough(),
        // C.2 (cycle 4): outer ToolView subtitle suppressed because CodexPatchViewFull's
        // inner fileHeader (CodexPatchView.tsx:150-157) already renders the full path +
        // kindLabel. Returning null avoids duplicating the file identity in the header.
        extractSubtitle: (_opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Show the number of files being modified
            const files = getPatchFiles(opts.tool.input);
            const fileCount = files.length;
            if (fileCount === 1) {
                const path = resolvePath(files[0], opts.metadata);
                const fileName = path.split('/').pop() || path;
                return t('tools.desc.modifyingFile', { file: fileName });
            } else if (fileCount > 1) {
                return t('tools.desc.modifyingFiles', { count: fileCount });
            }
            return t('tools.names.applyChanges');
        }
    },
    'GeminiBash': {
        title: t('tools.names.terminal'),
        icon: ICON_TERMINAL,
        minimal: true,
        hideDefaultError: true,
        isMutable: true,
        input: z.object({
            command: z.union([z.string(), z.array(z.string())]).describe('The command to execute'),
            cwd: z.string().optional().describe('Current working directory')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return stringifyToolCommand(opts.tool.input?.command);
        }
    },
    'GeminiPatch': {
        title: t('tools.names.applyChanges'),
        icon: ICON_EDIT,
        minimal: true,
        hideDefaultError: true,
        isMutable: true,
        input: z.object({
            auto_approved: z.boolean().optional().describe('Whether changes were auto-approved'),
            changes: z.record(z.string(), z.object({
                add: z.object({
                    content: z.string()
                }).optional(),
                modify: z.object({
                    old_content: z.string(),
                    new_content: z.string()
                }).optional(),
                delete: z.object({
                    content: z.string()
                }).optional()
            }).passthrough()).describe('File changes to apply')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Show the first file being modified
            if (opts.tool.input?.changes && typeof opts.tool.input.changes === 'object') {
                const files = Object.keys(opts.tool.input.changes);
                if (files.length > 0) {
                    const path = resolvePath(files[0], opts.metadata);
                    const fileName = path.split('/').pop() || path;
                    if (files.length > 1) {
                        return t('tools.desc.modifyingMultipleFiles', { 
                            file: fileName, 
                            count: files.length - 1 
                        });
                    }
                    return fileName;
                }
            }
            return null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Show the number of files being modified
            if (opts.tool.input?.changes && typeof opts.tool.input.changes === 'object') {
                const files = Object.keys(opts.tool.input.changes);
                const fileCount = files.length;
                if (fileCount === 1) {
                    const path = resolvePath(files[0], opts.metadata);
                    const fileName = path.split('/').pop() || path;
                    return t('tools.desc.modifyingFile', { file: fileName });
                } else if (fileCount > 1) {
                    return t('tools.desc.modifyingFiles', { count: fileCount });
                }
            }
            return t('tools.names.applyChanges');
        }
    },
    'CodexDiff': {
        title: t('tools.names.viewDiff'),
        icon: ICON_EDIT,
        minimal: false,  // Show full diff view
        hideDefaultError: true,
        noStatus: true,  // Always successful, stateless like Task
        input: z.object({
            unified_diff: z.string().describe('Unified diff content')
        }).partial().passthrough(),
        result: z.object({
            status: z.literal('completed').describe('Always completed')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Try to extract filename from unified diff
            if (opts.tool.input?.unified_diff && typeof opts.tool.input.unified_diff === 'string') {
                const diffLines = opts.tool.input.unified_diff.split('\n');
                for (const line of diffLines) {
                    if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
                        const fileName = line.replace(/^\+\+\+ (b\/)?/, '');
                        const basename = fileName.split('/').pop() || fileName;
                        return basename;
                    }
                }
            }
            return null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return t('tools.desc.showingDiff');
        }
    },
    'GeminiDiff': {
        title: t('tools.names.viewDiff'),
        icon: ICON_EDIT,
        minimal: false,  // Show full diff view
        hideDefaultError: true,
        noStatus: true,  // Always successful, stateless like Task
        input: z.object({
            unified_diff: z.string().optional().describe('Unified diff content'),
            filePath: z.string().optional().describe('File path'),
            description: z.string().optional().describe('Edit description')
        }).partial().passthrough(),
        result: z.object({
            status: z.literal('completed').describe('Always completed')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Try to extract filename from filePath first
            if (opts.tool.input?.filePath && typeof opts.tool.input.filePath === 'string') {
                const basename = opts.tool.input.filePath.split('/').pop() || opts.tool.input.filePath;
                return basename;
            }
            // Fall back to extracting from unified diff
            if (opts.tool.input?.unified_diff && typeof opts.tool.input.unified_diff === 'string') {
                const diffLines = opts.tool.input.unified_diff.split('\n');
                for (const line of diffLines) {
                    if (line.startsWith('+++ b/') || line.startsWith('+++ ')) {
                        const fileName = line.replace(/^\+\+\+ (b\/)?/, '');
                        const basename = fileName.split('/').pop() || fileName;
                        return basename;
                    }
                }
            }
            return null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return t('tools.desc.showingDiff');
        }
    },
    'AskUserQuestion': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            // Use first question header as title if available
            if (opts.tool.input?.questions && Array.isArray(opts.tool.input.questions) && opts.tool.input.questions.length > 0) {
                const firstQuestion = opts.tool.input.questions[0];
                if (firstQuestion.header) {
                    return firstQuestion.header;
                }
            }
            return t('tools.names.question');
        },
        icon: ICON_QUESTION,
        minimal: false,  // Always show expanded to display options
        noStatus: true,
        input: z.object({
            questions: z.array(z.object({
                question: z.string().describe('The question to ask'),
                header: z.string().describe('Short label for the question'),
                options: z.array(z.object({
                    label: z.string().describe('Option label'),
                    description: z.string().describe('Option description')
                })).describe('Available choices'),
                multiSelect: z.boolean().describe('Allow multiple selections')
            })).describe('Questions to ask the user')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            if (opts.tool.input?.questions && Array.isArray(opts.tool.input.questions)) {
                const count = opts.tool.input.questions.length;
                if (count === 1) {
                    return opts.tool.input.questions[0].question;
                }
                return t('tools.askUserQuestion.multipleQuestions', { count });
            }
            return null;
        }
    },
    'CronList': {
        title: t('tools.names.cronList'),
        icon: ICON_CLOCK,
        minimal: true,
        input: z.object({}).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const keys = Object.keys(input);
            if (keys.length === 0) {
                return null;
            }
            const summary = JSON.stringify(input);
            return summary.length > 40 ? summary.substring(0, 40) + '...' : summary;
        }
    },
    'web.search_query': {
        title: t('tools.names.webSearchQuery'),
        icon: ICON_SEARCH,
        minimal: true,
        input: z.object({ query: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const q = opts.tool.input?.query;
            if (typeof q === 'string' && q.length > 0) {
                return t('tools.desc.webSearching', { query: q.length > 60 ? q.substring(0, 60) + '...' : q });
            }
            return t('tools.names.webSearchQuery');
        }
    },
    'web.open': {
        title: t('tools.names.webOpen'),
        icon: ICON_LINK,
        minimal: true,
        input: z.object({ url: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const url = opts.tool.input?.url;
            if (typeof url === 'string' && url.length > 0) {
                return t('tools.desc.webOpening', { url: url.length > 80 ? url.substring(0, 80) + '...' : url });
            }
            return t('tools.names.webOpen');
        }
    },
    'web.find': {
        title: t('tools.names.webFind'),
        icon: ICON_SEARCH,
        minimal: true,
        input: z.object({ pattern: z.string().optional(), url: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const pattern = opts.tool.input?.pattern;
            const url = opts.tool.input?.url;
            if (typeof pattern === 'string' && pattern.length > 0) {
                const p = pattern.length > 40 ? pattern.substring(0, 40) + '...' : pattern;
                if (typeof url === 'string' && url.length > 0) {
                    const u = url.length > 40 ? url.substring(0, 40) + '...' : url;
                    return t('tools.desc.webFinding', { pattern: p, url: u });
                }
                return t('tools.desc.webFinding', { pattern: p, url: '' });
            }
            return t('tools.names.webFind');
        }
    },
    'web.weather': {
        title: t('tools.names.webWeather'),
        icon: ICON_WEATHER,
        minimal: true,
        input: z.object({ location: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const loc = opts.tool.input?.location;
            if (typeof loc === 'string' && loc.length > 0) {
                return t('tools.desc.webWeather', { location: loc.length > 60 ? loc.substring(0, 60) + '...' : loc });
            }
            return t('tools.names.webWeather');
        }
    },
    'web.time': {
        title: t('tools.names.webTime'),
        icon: ICON_CLOCK,
        minimal: true,
        input: z.object({ timezone: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const tz = opts.tool.input?.timezone;
            if (typeof tz === 'string' && tz.length > 0) {
                return t('tools.desc.webTime', { timezone: tz.length > 60 ? tz.substring(0, 60) + '...' : tz });
            }
            return t('tools.names.webTime');
        }
    },
    'web.click': {
        title: t('tools.names.webClick'),
        icon: ICON_HAND,
        minimal: true,
        input: z.object({ selector: z.string().optional(), link: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const selector = opts.tool.input?.selector;
            const link = opts.tool.input?.link;
            if (typeof selector === 'string' && selector.length > 0) {
                const s = selector.length > 60 ? selector.substring(0, 60) + '...' : selector;
                return t('tools.desc.webClicking', { selector: s, link: '' });
            }
            if (typeof link === 'string' && link.length > 0) {
                const l = link.length > 80 ? link.substring(0, 80) + '...' : link;
                return t('tools.desc.webClicking', { selector: '', link: l });
            }
            return t('tools.names.webClick');
        }
    },
    'web.image_query': {
        title: t('tools.names.webImageQuery'),
        icon: ICON_IMAGE,
        minimal: true,
        input: z.object({ query: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const q = opts.tool.input?.query;
            if (typeof q === 'string' && q.length > 0) {
                return t('tools.desc.webImageSearching', { query: q.length > 60 ? q.substring(0, 60) + '...' : q });
            }
            return t('tools.names.webImageQuery');
        }
    },
    'web.finance': {
        title: t('tools.names.webFinance'),
        icon: ICON_FINANCE,
        minimal: true,
        input: z.object({ symbol: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const symbol = opts.tool.input?.symbol;
            if (typeof symbol === 'string' && symbol.length > 0) {
                return t('tools.desc.webFinanceLookup', { symbol: symbol.length > 40 ? symbol.substring(0, 40) + '...' : symbol });
            }
            return t('tools.names.webFinance');
        }
    },
    'web.sports': {
        title: t('tools.names.webSports'),
        icon: ICON_SPORTS,
        minimal: true,
        input: z.object({ league: z.string().optional(), team: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const league = opts.tool.input?.league;
            const team = opts.tool.input?.team;
            const l = typeof league === 'string' && league.length > 0 ? (league.length > 40 ? league.substring(0, 40) + '...' : league) : '';
            const tm = typeof team === 'string' && team.length > 0 ? (team.length > 40 ? team.substring(0, 40) + '...' : team) : '';
            if (l || tm) {
                return t('tools.desc.webSportsLookup', { league: l, team: tm });
            }
            return t('tools.names.webSports');
        }
    },
    'web.screenshot': {
        title: t('tools.names.webScreenshot'),
        icon: ICON_SCAN,
        minimal: true,
        input: z.object({ target: z.string().optional() }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const target = opts.tool.input?.target;
            if (typeof target === 'string' && target.length > 0) {
                return t('tools.desc.webScreenshotting', { target: target.length > 80 ? target.substring(0, 80) + '...' : target });
            }
            return t('tools.names.webScreenshot');
        }
    },
    // Codex subagent lifecycle verbs.
    'functions.spawn_agent': {
        title: 'Spawn Agent',
        icon: ICON_TASK,
        minimal: (opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => {
            const messages = opts.messages || [];
            return !messages.some((message) => message.kind === 'tool-call' || message.kind === 'agent-text');
        },
        isMutable: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional(),
            prompt: z.string().optional(),
            sessionSubagent: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            return `Spawn: ${name}`;
        },
        extractStatus: codexToolStateStatus
    },
    'functions.send_input': {
        title: 'Send Input',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional(),
            input: z.string().optional(),
            message: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            const text = (typeof input.input === 'string' && input.input)
                || (typeof input.message === 'string' && input.message)
                || '';
            const truncated = text.length > 60 ? text.substring(0, 60) + '...' : text;
            return truncated ? `Send to ${name}: ${truncated}` : `Send to ${name}`;
        },
        extractStatus: codexToolStateStatus
    },
    'functions.wait_agent': {
        title: 'Wait for Agent',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional(),
            timeout: z.number().optional(),
            timeout_seconds: z.number().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            const timeoutVal = (typeof input.timeout === 'number' && input.timeout)
                || (typeof input.timeout_seconds === 'number' && input.timeout_seconds)
                || null;
            return timeoutVal !== null
                ? `Wait for ${name} (${timeoutVal}s)`
                : `Wait for ${name}`;
        },
        extractStatus: codexToolStateStatus
    },
    'functions.resume_agent': {
        title: 'Resume Agent',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            return `Resume: ${name}`;
        },
        extractStatus: codexToolStateStatus
    },
    'functions.close_agent': {
        title: 'Close Agent',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            return `Close: ${name}`;
        },
        extractStatus: codexToolStateStatus
    },
    // Cycle 6 — D.5 subagent lifecycle merged card. Synthetic envelope name
    // emitted by the CLI mapper (sessionProtocolMapper.ts) per spawn_agent;
    // the renderer suppresses the underlying spawn/wait/close cards via
    // codexToolRendering.useLifecycleSuppressionMap when this envelope is
    // present for the same sessionSubagent.
    'functions.subagent_lifecycle': {
        // B13 (Cycle 13): the inline header is the subagent's TASK title (matches
        // bug13-claude-agent.png), derived from agentNickname → first prompt line →
        // 'Subagent' fallback, NOT a generic 'Subagent' label (codex F1).
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const nickname = typeof input.agentNickname === 'string' ? input.agentNickname.trim() : '';
            if (nickname) return nickname.length > 80 ? nickname.substring(0, 80) + '…' : nickname;
            const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
            const firstLine = prompt.split('\n')[0]?.trim() ?? '';
            if (firstLine) return firstLine.length > 80 ? firstLine.substring(0, 80) + '…' : firstLine;
            return 'Subagent';
        },
        icon: ICON_TASK,
        isMutable: true,
        // B13 (Cycle 13 / codex F2 / AC-B13-3): header-only when the subagent
        // threaded no OWN (non-control) tools — minimal=true suppresses the body
        // wrapper so no empty bordered content area is rendered.
        minimal: (opts: { tool: ToolCall, messages?: Message[] }) => {
            const children = opts.messages ?? [];
            const hasOwnTool = children.some((m) =>
                m.kind === 'tool-call' && !isCodexSubagentControlTool(m.tool.name));
            return !hasOwnTool;
        },
        input: z.object({
            sessionSubagent: z.string().optional(),
            prompt: z.string().optional(),
            agentNickname: z.string().nullish(),
            lifecycle_state: z.string().optional(),
        }).partial().passthrough(),
        // B13 (Cycle 13 / G2-iter2): NO extractStatus — the inline header renders
        // the task title ONLY (matches taskLikeTool / bug13-claude-agent.png). The
        // user does not care about lifecycle state (per spec-20260520-051938 Cycle 13); a 'completed'/'error'
        // status word in the header is the rejected anti-target. State depth lives
        // in the detail view, not the inline header.
    },
    // §5.15 Phase D — Codex tool-suggest / parallel renderers (DORMANT until protocol emits events)
    'functions.tool_suggest': {
        title: t('tools.names.toolSuggest'),
        icon: ICON_REASONING,
        noStatus: true,
        input: z.object({
            tool_name: z.string().optional(),
            description: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            if (typeof input.tool_name === 'string' && input.tool_name) {
                return t('tools.desc.toolSuggesting', { name: input.tool_name });
            }
            return t('tools.names.toolSuggest');
        }
    },
    'multi_tool_use.parallel': {
        title: t('tools.names.parallelTool'),
        icon: ICON_TASK,
        minimal: false,
        input: z.object({
            tool_uses: z.array(z.any()).optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const uses = Array.isArray(input.tool_uses) ? input.tool_uses : [];
            return t('tools.desc.parallelToolCount', { count: uses.length });
        }
    },
    // §5.15 Phase E — Codex protocol-extension activation (cycle 2, dormant until now)
    'functions.write_stdin': {
        title: 'Write stdin',
        icon: ICON_TERMINAL,
        minimal: true,
        input: z.object({
            text: z.string().optional(),
            input: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const text = (typeof input.text === 'string' && input.text)
                || (typeof input.input === 'string' && input.input)
                || '';
            return text
                ? `Write: ${text.length > 60 ? text.substring(0, 60) + '...' : text}`
                : 'Write to stdin';
        }
    },
    'functions.update_plan': {
        title: 'Update plan',
        icon: ICON_TODO,
        minimal: false,
        noStatus: true,
        input: z.object({
            plan: z.union([z.string(), z.array(z.object({
                step: z.string().optional(),
                status: z.string().optional()
            }).passthrough())]).optional(),
            steps: z.array(z.any()).optional(),
            text: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const items = extractPlanItems(input);
            if (items.length > 0) return summarizePlanItems(items);
            const plan = (typeof input.text === 'string' && input.text) || '';
            return plan
                ? `Update plan: ${plan.length > 60 ? plan.substring(0, 60) + '...' : plan}`
                : 'Update plan';
        }
    },
    'functions.request_user_input': {
        title: 'Request user input',
        icon: ICON_QUESTION,
        minimal: true,
        input: z.object({
            prompt: z.string().optional(),
            question: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const prompt = (typeof input.prompt === 'string' && input.prompt)
                || (typeof input.question === 'string' && input.question)
                || '';
            return prompt
                ? `Ask: ${prompt.length > 80 ? prompt.substring(0, 80) + '...' : prompt}`
                : 'Request user input';
        },
        extractStatus: codexToolStateStatus
    },
    'functions.list_mcp_resources': {
        title: 'List MCP resources',
        icon: ICON_LINK,
        minimal: true,
        input: z.object({
            server: z.string().optional(),
            serverName: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const server = (typeof input.server === 'string' && input.server)
                || (typeof input.serverName === 'string' && input.serverName)
                || '';
            return server ? `List MCP resources: ${server}` : 'List MCP resources';
        }
    },
    'functions.list_mcp_resource_templates': {
        title: 'List MCP resource templates',
        icon: ICON_LINK,
        minimal: true,
        input: z.object({
            server: z.string().optional(),
            serverName: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const server = (typeof input.server === 'string' && input.server)
                || (typeof input.serverName === 'string' && input.serverName)
                || '';
            return server ? `List MCP templates: ${server}` : 'List MCP resource templates';
        }
    },
    'functions.read_mcp_resource': {
        title: 'Read MCP resource',
        icon: ICON_READ,
        minimal: false,
        input: z.object({
            uri: z.string().optional(),
            resourceUri: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const uri = (typeof input.uri === 'string' && input.uri)
                || (typeof input.resourceUri === 'string' && input.resourceUri)
                || '';
            return uri
                ? `Read: ${uri.length > 80 ? uri.substring(0, 80) + '...' : uri}`
                : 'Read MCP resource';
        },
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const uri = (typeof input.uri === 'string' && input.uri)
                || (typeof input.resourceUri === 'string' && input.resourceUri)
                || '';
            return uri || null;
        },
        extractStatus: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return typeof opts.tool.result?.status === 'string' ? opts.tool.result.status : null;
        }
    },
    'mcp__resources__read': {
        title: 'resources.read',
        icon: ICON_READ,
        minimal: false,
        input: z.object({
            uri: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const uri = typeof opts.tool.input?.uri === 'string' ? opts.tool.input.uri : '';
            return uri
                ? `Read: ${uri.length > 80 ? uri.substring(0, 80) + '...' : uri}`
                : 'resources.read';
        },
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const uri = typeof opts.tool.input?.uri === 'string' ? opts.tool.input.uri : '';
            return uri || null;
        },
        extractStatus: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return typeof opts.tool.result?.status === 'string' ? opts.tool.result.status : null;
        }
    },
    'mcp__playwright__browser_take_screenshot': {
        title: 'Playwright screenshot',
        icon: ICON_SCAN,
        minimal: false,
        input: z.object({
            filename: z.string().optional(),
            path: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const p = extractAttachmentSummary(opts.tool.input, opts.tool.result).path || '';
            return p ? `Screenshot: ${p.length > 80 ? p.substring(0, 80) + '...' : p}` : 'Playwright screenshot';
        }
    },
    // F.4 (cycle 4): Playwright long-input compact summary entries. The four
    // tools below have potentially huge `input` strings (data: URLs, JS source,
    // typed text). The inline card subtitle is truncated; full input remains
    // accessible in the expanded details panel via standard ToolView behavior.
    'mcp__playwright__browser_navigate': {
        title: 'Playwright navigate',
        icon: ICON_LINK,
        minimal: true,
        input: z.object({
            url: z.string().optional()
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const url = typeof opts.tool.input?.url === 'string' ? opts.tool.input.url : '';
            if (!url) return null;
            if (url.startsWith('data:')) {
                // Synthesize a "data: <mime>" synopsis with size when computable.
                const mimeMatch = url.match(/^data:([^;,]+)/);
                const mime = mimeMatch ? mimeMatch[1] : 'data';
                const sizeKb = (url.length / 1024).toFixed(1);
                return `data: ${mime} (${sizeKb} KB)`;
            }
            if (url.length > 120) {
                return url.substring(0, 60) + '…';
            }
            return url;
        }
    },
    'mcp__playwright__browser_evaluate': {
        title: 'Playwright evaluate',
        icon: ICON_TERMINAL,
        minimal: true,
        input: z.object({
            function: z.string().optional()
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const fn = typeof opts.tool.input?.function === 'string' ? opts.tool.input.function : '';
            if (!fn) return null;
            if (fn.length > 120) {
                return fn.substring(0, 60) + '…';
            }
            return fn;
        }
    },
    'mcp__playwright__browser_run_code': {
        title: 'Playwright run code',
        icon: ICON_TERMINAL,
        minimal: true,
        input: z.object({
            code: z.string().optional()
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const code = typeof opts.tool.input?.code === 'string' ? opts.tool.input.code : '';
            if (!code) return null;
            if (code.length > 120) {
                return code.substring(0, 60) + '…';
            }
            return code;
        }
    },
    'mcp__playwright__browser_type': {
        title: 'Playwright type',
        icon: ICON_EDIT,
        minimal: true,
        input: z.object({
            text: z.string().optional()
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const text = typeof opts.tool.input?.text === 'string' ? opts.tool.input.text : '';
            if (!text) return null;
            if (text.length > 120) {
                return text.substring(0, 60) + '…';
            }
            return text;
        }
    },
    'image_gen.imagegen': {
        title: 'Generated image',
        icon: ICON_IMAGE,
        minimal: false,
        input: z.object({
            prompt: z.string().optional()
        }).partial().passthrough(),
        // B05: surface the path in the header subtitle (ToolView reads extractSubtitle,
        // not extractDescription) so the flattened inner card need not repeat it.
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const summary = extractAttachmentSummary(opts.tool.input, opts.tool.result);
            return summary.path ?? summary.label;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const summary = extractAttachmentSummary(opts.tool.input, opts.tool.result);
            return summary.path ? `Generated: ${summary.path.length > 80 ? summary.path.substring(0, 80) + '...' : summary.path}` : summary.label;
        }
    },
    'functions.view_image': {
        title: 'View image',
        icon: ICON_IMAGE,
        minimal: false,
        input: z.object({
            path: z.string().optional(),
            image_path: z.string().optional()
        }).partial().passthrough(),
        // B05: surface the path in the header subtitle so the inner card collapses
        // to a single compact row (header carries icon+title+path; card = thumbnail only).
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return extractAttachmentSummary(opts.tool.input, opts.tool.result).path ?? null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const p = extractAttachmentSummary(opts.tool.input, opts.tool.result).path || '';
            return p
                ? `View: ${p.length > 80 ? p.substring(0, 80) + '...' : p}`
                : 'View image';
        }
    },
    'file': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return extractAttachmentSummary(opts.tool.input, opts.tool.result).label;
        },
        icon: ICON_IMAGE,
        minimal: false,
        noStatus: true,
        input: z.object({
            ref: z.string().optional(),
            name: z.string().optional(),
            size: z.number().optional(),
            image: z.object({
                width: z.number().optional(),
                height: z.number().optional(),
                thumbhash: z.string().optional(),
            }).partial().optional()
        }).partial().passthrough(),
        // B05: surface the path in the header subtitle (dimensions/size stay in the card).
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const summary = extractAttachmentSummary(opts.tool.input, opts.tool.result);
            return summary.path ?? null;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const summary = extractAttachmentSummary(opts.tool.input, opts.tool.result);
            return [summary.path, summary.dimensions, summary.size].filter(Boolean).join(' · ') || summary.label;
        }
    },
    // Codex subagent lifecycle verbs (without functions. prefix — reducer synthetic grouping).
    // These entries mirror functions.spawn_agent/send_input/wait_agent/close_agent but
    // handle the case where the reducer groups them under a synthetic 'spawn_agent' card.
    'spawn_agent': {
        title: 'Spawn Agent',
        icon: ICON_TASK,
        isMutable: true,
        minimal: (opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => {
            const messages = opts.messages || [];
            return !messages.some((message) => message.kind === 'tool-call' || message.kind === 'agent-text');
        },
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional(),
            prompt: z.string().optional(),
            sessionSubagent: z.string().optional()
        }).partial().passthrough(),
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            const input = opts.tool.input || {};
            const name = (typeof input.agent_name === 'string' && input.agent_name)
                || (typeof input.name === 'string' && input.name)
                || 'agent';
            return `Spawn: ${name}`;
        }
    },
    'send_input': {
        title: 'Send Input',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional(),
            input: z.string().optional()
        }).partial().passthrough()
    },
    'wait_agent': {
        title: 'Wait for Agent',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional()
        }).partial().passthrough()
    },
    'close_agent': {
        title: 'Close Agent',
        icon: ICON_TASK,
        minimal: true,
        input: z.object({
            agent_name: z.string().optional(),
            name: z.string().optional()
        }).partial().passthrough()
    },
    // Internal Claude Code tool for loading deferred tools - no user-visible output
    'ToolSearch': {
        icon: ICON_SEARCH,
        hidden: true,
    }
} satisfies Record<string, {
    title?: string | ((opts: { metadata: Metadata | null, tool: ToolCall }) => string);
    icon: (size: number, color: string) => React.ReactNode;
    noStatus?: boolean;
    hideDefaultError?: boolean;
    hidden?: boolean;
    isMutable?: boolean;
    input?: z.ZodObject<any>;
    result?: z.ZodObject<any>;
    minimal?: boolean | ((opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => boolean);
    extractDescription?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string;
    extractSubtitle?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string | null;
    extractStatus?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string | null;
}>;

/**
 * Check if a tool is mutable (can potentially modify files)
 * @param toolName The name of the tool to check
 * @returns true if the tool is mutable or unknown, false if it's read-only
 */
export function isMutableTool(toolName: string): boolean {
    const tool = knownTools[toolName as keyof typeof knownTools];
    if (tool) {
        if ('isMutable' in tool) {
            return tool.isMutable === true;
        } else {
            return false;
        }
    }
    // If tool is unknown, assume it's mutable to be safe
    return true;
}
