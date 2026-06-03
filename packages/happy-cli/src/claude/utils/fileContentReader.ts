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

// B05 R2 (PRODUCER): a Claude `Read` whose target is an image file gets an
// inline preview. The app-side ReadView consumes `tool.result.preview_uri`
// (via extractAttachmentSummary → attachmentHasRenderableImagePreview), so the
// mapper must SYNTHESIZE that preview here — a raw image Read result carries no
// renderable uri/base64 field of its own. Mirrors the Codex view_image
// buildPathImagePreview producer. 5MB cap (matches Codex IMAGE_PREVIEW_MAX_BYTES).
const IMAGE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};

function imageMimeForReadPath(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_MIME_BY_EXTENSION[ext] ?? null;
}

/**
 * Build the structured image-preview result for a Claude Read of an image file.
 * Returns `{ path, preview_uri }` (data:<mime>;base64,…) when the path is a
 * supported, readable, under-cap image; `undefined` for a non-image / oversized
 * / unreadable target so a text Read never gains a (broken) preview.
 */
export function buildReadImagePreview(filePath: string): Record<string, unknown> | undefined {
    const mime = imageMimeForReadPath(filePath);
    if (!mime) return undefined;
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > IMAGE_PREVIEW_MAX_BYTES) return undefined;
        const base64 = fs.readFileSync(filePath).toString('base64');
        return { path: filePath, preview_uri: `data:${mime};base64,${base64}` };
    } catch {
        return undefined;
    }
}
