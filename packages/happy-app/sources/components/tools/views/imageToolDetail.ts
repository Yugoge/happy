import { extractAttachmentSummary } from '@/utils/codexToolRendering';

// Wave-1 Item 1 (spec-20260607-124814 §2): pure, node-env-importable core of the
// image-tool DETAIL view (ImageToolFullView.tsx). Kept RN-free AND i18n-free so the
// sanitizer and output builder are unit-testable in the node-env Vitest (the component
// file imports react-native / react-native-unistyles, and @/text transitively imports
// expo-localization → react-native, so neither can load there). The component supplies
// the translated redaction placeholder via t(...); these pure functions take it as a
// parameter (default = a plain ASCII sentinel) and return STRUCTURED data, never
// pre-formatted prose. The detail page must be text-only: Description → Input Params
// (JSON, base64 stripped) → Output (path / dimensions / type) — NEVER an <Image>,
// NEVER a raw base64 / data-URI substring.

// Default redaction sentinel used when the caller (or a unit test) does not pass a
// translated placeholder. The component passes t('tools.fullView.redactedBinary').
export const REDACTED_BINARY_PLACEHOLDER = '[binary data omitted]';

// Single source-of-truth set so the mobile registry (_all.tsx toolFullViewRegistry), the
// mobile payload-ownership gate (ToolFullView SPECIALIZED_FULL_PAYLOAD_TOOLS) and the
// desktop sidebar branch (SidebarContentRenderer) all route the SAME tool names — a
// parity test pins the three sites together so one cannot drift from another.
export const IMAGE_DETAIL_TOOLS = new Set<string>([
    'functions.view_image',
    'mcp__playwright__browser_take_screenshot',
    'functions.image_generation',
    // Should-Have (BA ticket §Should Have): a `file` attachment carrying an image would
    // otherwise still render the image on detail (same leak class) — route it here too.
    // Requirement-consistent inclusion, NOT silent scope creep.
    'file',
    // Legacy / guessed image-gen aliases that share CodexAttachmentView routing in the
    // detail registries; routing them here keeps the detail surfaces free of any residual
    // image-render path (parity).
    'mcp__image_gen__imagegen',
    'image_gen.imagegen',
]);

// Keys whose VALUES carry raw base64 image bytes (mirrors the read-only contract in
// codexToolRendering.ts ATTACHMENT_BASE64_KEYS). Stripped recursively before stringify.
const BASE64_VALUE_KEYS = new Set<string>([
    'base64', 'imageBase64', 'image_base64', 'b64_json', 'data',
]);

// Keys that may carry a data:image/...;base64,... URI as their string value. The value is
// redacted (the key is kept) so the structure stays legible.
const URI_VALUE_KEYS = new Set<string>([
    'preview_uri', 'previewUri', 'url', 'uri',
]);

// data:image data-URI matcher (codex finding 3 — broadened): case-insensitive, accepts
// optional MIME parameters (e.g. ;charset=utf-8) before ;base64, and base64url chars, and
// swallows interleaved whitespace/newlines in the payload so a multiline blob is fully
// redacted (not just its prefix).
const DATA_IMAGE_PATTERN =
    'data:image\\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,\\s]+)*;base64,[a-z0-9+/=_-]+(?:\\s+[a-z0-9+/=_-]+)*';

function containsDataImage(value: string): boolean {
    // Fresh RegExp per call: a shared /g literal carries mutable lastIndex state that
    // would make repeated .test() non-deterministic.
    return new RegExp(DATA_IMAGE_PATTERN, 'i').test(value);
}

function redactDataImageStrings(value: string, placeholder: string): string {
    return value.replace(new RegExp(DATA_IMAGE_PATTERN, 'gi'), placeholder);
}

// Redact any data:image data-URI found in a free-text string (e.g. tool.description),
// which is rendered verbatim and is NOT routed through the structured input sanitizer
// (codex finding 1). Pure + exported for unit testing.
export function sanitizeImageToolText(
    value: string,
    placeholder: string = REDACTED_BINARY_PLACEHOLDER,
): string {
    return containsDataImage(value) ? redactDataImageStrings(value, placeholder) : value;
}

// Recursively strip raw image bytes from an arbitrary tool input so the Input Parameters
// JSON can be rendered without leaking base64. Covers: known base64 value keys (replaced
// with the redaction placeholder), known URI keys whose value is a data:image (redacted),
// any string value anywhere containing a data:image data-URI (redacted), and nested
// arrays/objects (incl. the contentItems / content / contentBlocks shapes that hide bytes
// deep). Pure + exported so it is unit-testable in node-env Vitest (RN cannot mount there).
export function sanitizeImageToolInput(
    value: unknown,
    placeholder: string = REDACTED_BINARY_PLACEHOLDER,
    depth = 0,
): unknown {
    if (depth > 8) return undefined;
    if (typeof value === 'string') {
        return containsDataImage(value) ? redactDataImageStrings(value, placeholder) : value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeImageToolInput(item, placeholder, depth + 1));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
            if (BASE64_VALUE_KEYS.has(key)) {
                out[key] = placeholder;
                continue;
            }
            if (URI_VALUE_KEYS.has(key) && typeof raw === 'string' && /^data:image\//i.test(raw.trim())) {
                out[key] = placeholder;
                continue;
            }
            out[key] = sanitizeImageToolInput(raw, placeholder, depth + 1);
        }
        return out;
    }
    return value;
}

export function sanitizedInputJson(input: unknown, placeholder: string = REDACTED_BINARY_PLACEHOLDER): string {
    return JSON.stringify(sanitizeImageToolInput(input, placeholder), null, 2);
}

const TYPE_BY_EXTENSION: Record<string, string> = {
    png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP',
    svg: 'SVG', bmp: 'BMP', avif: 'AVIF', heic: 'HEIC', tiff: 'TIFF',
};

// Derive a human type token from the path extension; null when absent/unrecognized so the
// caller can render its own i18n 'unknown' label. Pure + i18n-free for node-env testing.
export function deriveImageType(path: string | null): string | null {
    if (!path) return null;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return TYPE_BY_EXTENSION[ext] ?? null;
}

export type ImageToolOutput = {
    path: string | null;
    dimensions: string | null;
    type: string | null;
};

// codex finding 2: summary.path is read from raw input/result fields (path/ref/file_path…)
// and could itself be a data:image / base64 blob; reject any path carrying image bytes so
// the Output never leaks base64. A legitimate file path never contains these substrings.
function safeOutputPath(path: string | null): string | null {
    if (!path) return null;
    if (/data:image\//i.test(path) || /;base64,/i.test(path)) return null;
    // A bare base64-looking blob (no path separators, long, base64 charset) is not a path.
    const trimmed = path.trim();
    if (!/[\\/.]/.test(trimmed) && trimmed.length > 64 && /^[A-Za-z0-9+/=_-]+$/.test(trimmed)) return null;
    return path;
}

// codex finding 2: dimensions is "W×H" derived from raw width/height fields. Accept only a
// strict numeric NxN shape so a base64/data-URI value smuggled via width/height cannot show.
function safeDimensions(dimensions: string | null): string | null {
    if (!dimensions) return null;
    return /^\d+[×x]\d+$/.test(dimensions.trim()) ? dimensions : null;
}

// Build the ALLOWLISTED, VALIDATED output object {path, dimensions, type}. NEVER reads,
// spreads, or stringifies previewUri (it can itself be a data:image/...;base64,... URI —
// codex finding 5); scalars are additionally validated so a base64/data-URI smuggled into
// path/ref/width/height cannot reach the Output (codex finding 2). `type` is a raw token
// (or null) derived from the SANITIZED path — the component maps null → t('…unknownType').
// Pure + exported for unit testing.
export function buildImageToolOutput(input: unknown, result?: unknown): ImageToolOutput {
    const summary = extractAttachmentSummary(input, result);
    const path = safeOutputPath(summary.path);
    return {
        path,
        dimensions: safeDimensions(summary.dimensions),
        type: deriveImageType(path),
    };
}
