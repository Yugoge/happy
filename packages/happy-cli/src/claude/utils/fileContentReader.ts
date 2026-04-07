import * as fs from 'fs';

const FILE_CONTENT_MAX_BYTES = 100 * 1024; // 100KB cap for injected file content

/**
 * Tools whose tool-call-end should include the current file content.
 * The file path is read from the tool_use input.file_path.
 */
export const FILE_CONTENT_TOOLS = new Set(['Edit', 'Write']);

/**
 * Read a file's content for injection into tool-call-end output.
 * Caps at 100KB to prevent message bloat. Returns empty string on error.
 */
export function readFileContentForToolEnd(filePath: string): string {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > FILE_CONTENT_MAX_BYTES) {
            const fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(FILE_CONTENT_MAX_BYTES);
            fs.readSync(fd, buf, 0, FILE_CONTENT_MAX_BYTES, 0);
            fs.closeSync(fd);
            return buf.toString('utf-8') + '\n... (truncated)';
        }
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}
