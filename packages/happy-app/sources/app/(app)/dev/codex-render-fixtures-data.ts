import type { Message, ToolCall } from '@/sync/typesMessage';

export const CODEX_RENDER_FIXTURE_SESSION_ID = 'dev-codex-render-fixtures';

export type CodexRenderFixture = {
    id: string;
    matrixRow: string;
    matrix: ToolRenderingMatrixRow;
    title: string;
    description: string;
    message: Message;
    tool: ToolCall | null;
    expectedVisibleStrings: {
        inline: string[];
        detail: string[];
        sidebar?: string[];
    };
};

export type ToolRenderingMatrixRow = {
    userToolToken: string;
    rendererToolKey: string;
    outputType: string;
    visibility: string;
    inlinePreview: string;
    rawJson: string;
    state: string;
    classification: 'success' | 'partial' | 'failure' | 'unavailable' | 'unverified';
};

const BASE_TIME = Date.UTC(2026, 3, 28, 13, 30, 0);
const IMAGE_PREVIEW_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFBQIAHl6u2QAAAABJRU5ErkJggg==';

function makeTool(name: string, state: ToolCall['state'], input: any, result?: any, description: string | null = null): ToolCall {
    return {
        name,
        state,
        input,
        result,
        createdAt: BASE_TIME,
        startedAt: BASE_TIME + 1000,
        completedAt: state === 'running' ? null : BASE_TIME + 2000,
        description,
    };
}

function makeToolMessage(id: string, tool: ToolCall, offset: number): Message {
    return {
        id,
        localId: null,
        createdAt: BASE_TIME + offset,
        kind: 'tool-call',
        tool,
        children: [],
    };
}

function makeAgentMessage(id: string, text: string, offset: number): Message {
    return {
        id,
        localId: null,
        createdAt: BASE_TIME + offset,
        kind: 'agent-text',
        text,
    };
}

function makeMatrix(
    userToolToken: string,
    rendererToolKey: string,
    outputType: string,
    inlinePreview: string,
    classification: ToolRenderingMatrixRow['classification'] = 'success',
): ToolRenderingMatrixRow {
    return {
        userToolToken,
        rendererToolKey,
        outputType,
        visibility: 'main card + details',
        inlinePreview,
        rawJson: 'details-only',
        state: classification === 'unavailable' ? 'visible unavailable' : 'completed/frozen',
        classification,
    };
}

const terminalTool = makeTool(
    'CodexBash',
    'error',
    {
        command: ['/bin/bash', '-lc', 'printf codex-rendering-stdout; printf codex-rendering-stderr >&2'],
        parsed_cmd: [{ type: 'bash', cmd: 'printf codex-rendering-stdout; printf codex-rendering-stderr >&2' }],
    },
    {
        stdout: 'codex-rendering-stdout',
        stderr: 'codex-rendering-stderr',
        exit_code: 7,
        status: 'failed',
    },
    '/bin/bash -lc "printf codex-rendering-stdout; printf codex-rendering-stderr >&2"',
);

const patchTool = makeTool(
    'CodexPatch',
    'completed',
    {
        changes: {
            'packages/example.ts': {
                type: 'update',
                unified_diff: '@@ -1 +1 @@\n-const value = "old";\n+const value = "new";',
            },
        },
    },
    { status: 'completed' },
);

const planTool = makeTool(
    'functions.update_plan',
    'completed',
    {
        plan: [
            { step: 'Inspect payload', status: 'completed' },
            { step: 'Render fallback', status: 'in_progress' },
        ],
    },
    { text: 'Inspect payload\nRender fallback' },
);

const parallelTool = makeTool(
    'multi_tool_use.parallel',
    'completed',
    {
        tool_uses: [
            { recipient_name: 'functions.exec_command', parameters: { cmd: 'pwd' } },
            { recipient_name: 'mcp__resources__read', parameters: { uri: 'file://fixture.md' } },
        ],
    },
    {
        status: 'completed',
        results: [
            { name: 'functions.exec_command', stdout: 'parallel tool A: shell branch', stderr: 'parallel stderr A' },
            { name: 'mcp__resources__read', result: { resources: [] } },
        ],
    },
);

const imageTool = makeTool(
    'functions.view_image',
    'completed',
    {
        path: '/tmp/render-fixtures/plot.png',
        preview_uri: IMAGE_PREVIEW_URI,
        image: { width: 640, height: 480 },
        size: 2048,
    },
    { path: '/tmp/render-fixtures/plot.png', status: 'completed' },
);

const screenshotTool = makeTool(
    'mcp__playwright__browser_take_screenshot',
    'completed',
    { filename: 'playwright-fixture.png' },
    {
        path: '/tmp/render-fixtures/playwright-fixture.png',
        preview_uri: IMAGE_PREVIEW_URI,
        status: 'completed',
    },
);

const generatedImageTool = makeTool(
    'image_gen.imagegen',
    'completed',
    { prompt: 'tiny fixture image' },
    {
        path: '/tmp/render-fixtures/generated-image.png',
        preview_uri: IMAGE_PREVIEW_URI,
        status: 'completed',
    },
);

// B05 R2 (PRODUCER→CONSUMER): a Claude `Read` of an image file. The happy-cli
// claude sessionProtocolMapper synthesizes `result.preview_uri` for an image
// Read (buildReadImagePreview); the fixture carries that producer-emitted shape
// so ReadView is live-exercisable at /dev/codex-render-fixtures.
const readImageTool = makeTool(
    'Read',
    'completed',
    { file_path: '/tmp/render-fixtures/claude-read.png' },
    { path: '/tmp/render-fixtures/claude-read.png', preview_uri: IMAGE_PREVIEW_URI },
);

// B05 R2 (no-regression control): a Claude `Read` of a TEXT file. The producer
// emits NO preview_uri for a non-image target, so ReadView returns null and the
// card stays header-only — proving the preview never leaks onto text Reads.
const readTextTool = makeTool(
    'Read',
    'completed',
    { file_path: '/tmp/render-fixtures/notes.txt' },
    'line one\nline two\nline three',
);

const spawnAgentTool = makeTool(
    'functions.spawn_agent',
    'completed',
    {
        tool: 'spawnAgent',
        prompt: 'inspect fixture rendering',
        sessionSubagent: 'codex-fixture-subagent',
    },
    { status: 'completed' },
);

const waitAgentTool = makeTool(
    'functions.wait_agent',
    'completed',
    { name: 'fixture-agent', timeout: 30, sessionSubagent: 'codex-fixture-subagent' },
    { status: 'completed' },
);

const closeAgentTool = makeTool(
    'functions.close_agent',
    'completed',
    { name: 'fixture-agent', sessionSubagent: 'codex-fixture-subagent' },
    { status: 'completed' },
);

// Cycle 6 — D.5 subagent lifecycle merged card. Synthetic envelope.
const lifecycleAgentTool = makeTool(
    'functions.subagent_lifecycle',
    'completed',
    {
        sessionSubagent: 'codex-fixture-subagent',
        prompt: 'inspect fixture rendering',
        agentNickname: 'fixture-agent',
        lifecycle_state: 'started',
    },
    {
        status: 'completed',
        lifecycle_state: 'completed',
        final_summary: 'inspected fixture rendering',
    },
);

const requestInputUnavailableTool = makeTool(
    'functions.request_user_input',
    'error',
    { question: 'Choose a fixture option' },
    {
        status: 'unavailable',
        error: 'request_user_input is only available in Plan mode',
    },
);

const webSearchTool = makeTool(
    'web.search_query',
    'completed',
    { search_query: [{ q: 'Happy renderer' }] },
    {
        status: 'completed',
        results: [{
            title: 'Example result title',
            url: 'https://example.com/rendering',
            snippet: 'Short source snippet',
        }],
    },
);

const webWeatherTool = makeTool(
    'web.weather',
    'completed',
    { weather: [{ location: 'San Francisco, CA' }] },
    {
        status: 'completed',
        weather: [{ location: 'San Francisco', summary: 'Fog then sun' }],
    },
);

// Closes close-report-spec-20260506-203844.md primary dispositive finding:
// web.open is named in spec sections 2.1, 5.3.A, 5.3.G but was absent from cycle-2 fixture matrix.
// Renderer key matches knownTools.tsx:982 ('web.open' lowercase dotted) and zod input schema requires `url`.
const webOpenTool = makeTool(
    'web.open',
    'completed',
    { url: 'https://example.com/open' },
    {
        status: 'completed',
        url: 'https://example.com/open',
        title: 'Example fetched page title',
        snippet: 'Short fetched content snippet',
    },
);

const ptyWriteTool = makeTool(
    'functions.write_stdin',
    'completed',
    { session_id: 123, chars: 'hello from stdin\n' },
    { status: 'completed', output: 'stdin accepted by running PTY' },
);

const resourceListTool = makeTool(
    'functions.list_mcp_resources',
    'completed',
    { server: 'Codex' },
    {
        server: 'Codex',
        tool: 'list_mcp_resources',
        status: 'completed',
        resources: [],
    },
);

const resourceTemplatesTool = makeTool(
    'functions.list_mcp_resource_templates',
    'completed',
    { server: 'Codex' },
    {
        server: 'Codex',
        tool: 'list_mcp_resource_templates',
        status: 'completed',
        resourceTemplates: [],
    },
);

const readResourceTool = makeTool(
    'functions.read_mcp_resource',
    'completed',
    { uri: 'file://fixture.md' },
    {
        status: 'completed',
        uri: 'file://fixture.md',
        content: 'Fixture resource content',
    },
);

const unknownTool = makeTool(
    'functions.future_tool',
    'error',
    {
        nested: {
            value: ['unknown', { type: 'payload' }],
        },
    },
    {
        error: 'user rejected MCP tool call',
        reason: { type: 'payload', status: 'denied' },
    },
);

// G.4 (cycle 4): three new specialized web tools. Renderer keys
// 'web.time' / 'web.finance' / 'web.sports' already exist in
// knownTools.tsx:1027/1072/1085 — we are filling missing fixture rows.
// Result arrays (`time`, `finance`, `sports`) match the keys
// summarizeWebResult() in utils/codexToolRendering.ts:148 reads.
const webTimeTool = makeTool(
    'web.time',
    'completed',
    { timezone: 'Asia/Tokyo' },
    {
        status: 'completed',
        time: [{ name: 'Asia/Tokyo', value: '2026-05-07T14:00:00+09:00' }],
    },
);

const webFinanceTool = makeTool(
    'web.finance',
    'completed',
    { symbol: 'AAPL' },
    {
        status: 'completed',
        finance: [{ ticker: 'AAPL', summary: 'AAPL 231.45 (+1.20)' }],
    },
);

const webSportsTool = makeTool(
    'web.sports',
    'completed',
    { league: 'NBA', team: 'Lakers' },
    {
        status: 'completed',
        sports: [{ league: 'NBA', summary: 'Lakers 112 - 108' }],
    },
);

// F.4 (cycle 4): playwright-data-url fixture exercises the new Playwright
// browser_navigate extractSubtitle that synthesizes a "data: <mime> (<size> KB)"
// synopsis instead of rendering a 200+ char data URL inline. The full URL
// remains accessible in the expanded details panel.
const PLAYWRIGHT_DATA_URL_PAYLOAD =
    'data:text/html,<html><head><title>Playwright Long Data URL Fixture</title></head><body><h1>Encoded HTML payload deliberately long enough to exercise truncation</h1><p>This paragraph is intentionally verbose so the resulting data URL exceeds two hundred characters in length.</p></body></html>';

const playwrightDataUrlTool = makeTool(
    'mcp__playwright__browser_navigate',
    'completed',
    { url: PLAYWRIGHT_DATA_URL_PAYLOAD },
    { status: 'completed', url: PLAYWRIGHT_DATA_URL_PAYLOAD },
);

// B.7 (cycle 4): image-class result with NO preview_uri AND NO
// preview_unavailable_reason — emulates an old message persisted before the
// cycle-1 mapper fix. CodexAttachmentView falls back to the new i18n
// 'tools.attachment.staleAdvisory' string.
const imageStaleTool = makeTool(
    'functions.view_image',
    'completed',
    { path: '/tmp/render-fixtures/legacy-stale.png' },
    { path: '/tmp/render-fixtures/legacy-stale.png', status: 'completed' },
);

export const codexRenderFixtures: CodexRenderFixture[] = [
    {
        id: 'qa-b06b07b08',
        matrixRow: 'qa_b06b07b08',
        matrix: makeMatrix('assistant.text', 'MessageView.MarkdownView', 'markdown text', 'inline rich text'),
        title: 'QA B06/B07/B08 fixture',
        description: 'QA-20260602: two footnotes (B06), details (B07), Chinese+English inline code (B08).',
        tool: null,
        message: makeAgentMessage('codex-fixture-qa-b06b07b08', [
            '# QA fixture B06/B07/B08',
            '',
            'Body text with English inline code `result` and Chinese inline code `用户名称` and another `中文行内代码测试` span. First ref[^one] and second ref[^two].',
            '',
            'A plain paragraph between, no code here.',
            '',
            '<details>',
            '<summary>点击展开详情 / Click to expand</summary>',
            'Hidden disclosure body with `code` inside.',
            '</details>',
            '',
            '[^one]: 第一个脚注 first footnote body with `inline`.',
            '[^two]: 第二个脚注 second footnote body.',
        ].join('\n'), 0),
        expectedVisibleStrings: {
            inline: ['QA fixture', 'result', '用户名称', '点击展开详情'],
            detail: ['QA fixture', 'result', '用户名称', '点击展开详情'],
        },
    },
    {
        id: 'markdown-rich-detail',
        matrixRow: 'markdown_rich_text',
        matrix: makeMatrix('assistant.text', 'MessageView.MarkdownView', 'markdown text', 'inline rich text'),
        title: 'Markdown/rich content',
        description: 'Inline and detail MarkdownView coverage for rich Codex text.',
        tool: null,
        message: makeAgentMessage('codex-fixture-markdown-rich-detail', [
            '# Codex Markdown Fixture',
            '- [x] task item with **bold** text',
            '> Blockquote with ~~strikethrough~~ and [link](https://example.com/codex-fixture)',
            '`inline code` &lt;entity&gt; and plain expression x + y',
            '',
            '| Column | Value |',
            '|---|---|',
            '| wide-table-proof | rendered |',
            '',
            // Cycle 8 (#9, #10, #11) saga-closer probes — saga spec-20260506-203755.
            'Cycle 8 probes: see [docs][refdoc] and footnote[^c8] and <mark>highlight</mark>.',
            'H<sub>2</sub>O and E=mc<sup>2</sup>; <abbr title="World Wide Web">WWW</abbr>.',
            '',
            '<details open>',
            '<summary>Click to toggle</summary>',
            'Hidden body paragraph.',
            '</details>',
            '',
            '[refdoc]: https://example.com/refdoc',
            '[^c8]: footnote body for cycle 8.',
        ].join('\n'), 0),
        expectedVisibleStrings: {
            inline: ['Codex Markdown Fixture', 'task item', 'wide-table-proof', 'x + y',
                'docs', 'highlight', 'WWW', 'Click to toggle'],
            detail: ['Codex Markdown Fixture', 'task item', 'wide-table-proof', 'x + y',
                'docs', 'highlight', 'WWW', 'Click to toggle'],
        },
    },
    {
        id: 'terminal-stdout-stderr-exit',
        matrixRow: 'terminal_stdout_stderr_exit',
        matrix: makeMatrix('functions.exec_command', 'CodexBash', 'terminal stdout/stderr/exit', 'terminal text'),
        title: 'Terminal stdout/stderr/exit',
        description: 'Command, stdout, stderr, exit/status, and command-once detail semantics.',
        tool: terminalTool,
        message: makeToolMessage('codex-fixture-terminal-stdout-stderr-exit', terminalTool, 1000),
        expectedVisibleStrings: {
            inline: [
                'printf codex-rendering-stdout',
                'codex-rendering-stdout',
                'codex-rendering-stderr',
                'exit 7',
                'status: failed',
            ],
            detail: [
                'printf codex-rendering-stdout',
                'codex-rendering-stdout',
                'codex-rendering-stderr',
                'exit 7',
                'status: failed',
            ],
            sidebar: [
                'printf codex-rendering-stdout',
                'codex-rendering-stdout',
                'codex-rendering-stderr',
                'exit 7',
                'status: failed',
            ],
        },
    },
    {
        id: 'patch-unified-diff',
        matrixRow: 'patch_diff',
        matrix: makeMatrix('apply_patch', 'CodexPatch', 'patch summary + diff detail', 'file list inline'),
        title: 'Patch unified diff',
        description: 'Patch detail renders complete old/new diff instead of raw diff JSON first.',
        tool: patchTool,
        message: makeToolMessage('codex-fixture-patch-unified-diff', patchTool, 2000),
        expectedVisibleStrings: {
            inline: ['packages/example.ts', 'EDIT'],
            detail: ['packages/example.ts', 'const value = "old";', 'const value = "new";'],
            sidebar: ['packages/example.ts', 'const value = "old";', 'const value = "new";'],
        },
    },
    {
        id: 'update-plan',
        matrixRow: 'plan_update',
        matrix: makeMatrix('functions.update_plan', 'functions.update_plan', 'plan steps', 'inline plan rows'),
        title: 'functions.update_plan',
        description: 'Plan steps and statuses visible inline, detail, sidebar, and mobile.',
        tool: planTool,
        message: makeToolMessage('codex-fixture-update-plan', planTool, 3000),
        expectedVisibleStrings: {
            inline: ['Plan: 2 steps', 'Inspect payload', 'Render fallback'],
            detail: ['Plan: 2 steps', 'Inspect payload', 'Render fallback'],
            sidebar: ['Plan: 2 steps', 'Inspect payload', 'Render fallback'],
        },
    },
    {
        id: 'parallel-tools',
        matrixRow: 'multi_tool_sequences',
        matrix: makeMatrix('multi_tool_use.parallel', 'multi_tool_use.parallel', 'parallel child summaries', 'inline summary'),
        title: 'multi_tool_use.parallel',
        description: 'Parallel child tool names and arguments are discoverable.',
        tool: parallelTool,
        message: makeToolMessage('codex-fixture-parallel-tools', parallelTool, 4000),
        expectedVisibleStrings: {
            inline: ['Parallel tool', 'functions.exec_command', 'parallel tool A', 'parallel stderr A'],
            detail: ['Parallel tool', 'functions.exec_command', 'parallel tool A', 'parallel stderr A'],
            sidebar: ['Parallel tool', 'functions.exec_command', 'parallel tool A', 'parallel stderr A'],
        },
    },
    {
        id: 'image-view',
        matrixRow: 'image_attachment',
        matrix: makeMatrix('functions.view_image', 'functions.view_image', 'image path + data URI', 'true inline image'),
        title: 'functions.view_image',
        description: 'View-image metadata and preview are distinct from binary attachment cards.',
        tool: imageTool,
        message: makeToolMessage('codex-fixture-image-view', imageTool, 5000),
        expectedVisibleStrings: {
            inline: ['plot.png', '/tmp/render-fixtures/plot.png', '640×480'],
            detail: ['plot.png', '/tmp/render-fixtures/plot.png', '640×480'],
            sidebar: ['plot.png', '/tmp/render-fixtures/plot.png', '640×480'],
        },
    },
    {
        id: 'playwright-screenshot',
        matrixRow: 'image_inline_screenshot',
        matrix: makeMatrix('mcp__playwright__.browser_take_screenshot', 'mcp__playwright__browser_take_screenshot', 'screenshot path + data URI', 'true inline image'),
        title: 'mcp__playwright__.browser_take_screenshot',
        description: 'Dotted user token crosswalks to normalized renderer key and shows a screenshot preview.',
        tool: screenshotTool,
        message: makeToolMessage('codex-fixture-playwright-screenshot', screenshotTool, 6000),
        expectedVisibleStrings: {
            inline: ['playwright-fixture.png', '/tmp/render-fixtures/playwright-fixture.png'],
            detail: ['playwright-fixture.png', '/tmp/render-fixtures/playwright-fixture.png'],
            sidebar: ['playwright-fixture.png', '/tmp/render-fixtures/playwright-fixture.png'],
        },
    },
    {
        id: 'image-generation',
        matrixRow: 'image_inline_generation',
        matrix: makeMatrix('image_gen.imagegen', 'image_gen.imagegen', 'generated image path + data URI', 'true inline image'),
        title: 'image_gen.imagegen',
        description: 'Generated-image output displays an inline preview instead of only a path.',
        tool: generatedImageTool,
        message: makeToolMessage('codex-fixture-image-generation', generatedImageTool, 7000),
        expectedVisibleStrings: {
            inline: ['generated-image.png', '/tmp/render-fixtures/generated-image.png'],
            detail: ['generated-image.png', '/tmp/render-fixtures/generated-image.png'],
            sidebar: ['generated-image.png', '/tmp/render-fixtures/generated-image.png'],
        },
    },
    // B05 R2: Claude Read of an IMAGE — producer-synthesized preview_uri drives
    // the inline ReadView thumbnail (bidirectional "Claude Code gains a Codex-
    // style preview").
    {
        id: 'claude-read-image',
        matrixRow: 'claude_read_image_preview',
        matrix: makeMatrix('Read', 'Read', 'image path + producer data URI', 'true inline image'),
        title: 'Read (image)',
        description: 'Claude Read of an image renders an inline preview thumbnail (producer-synthesized preview_uri).',
        tool: readImageTool,
        message: makeToolMessage('codex-fixture-claude-read-image', readImageTool, 7400),
        expectedVisibleStrings: {
            inline: ['claude-read.png'],
            detail: ['claude-read.png', '/tmp/render-fixtures/claude-read.png'],
            sidebar: ['claude-read.png'],
        },
    },
    // B05 R2 no-regression control: Claude Read of a TEXT file — no preview_uri,
    // so ReadView returns null and the card stays header-only (text Reads must
    // NOT gain a thumbnail).
    {
        id: 'claude-read-text',
        matrixRow: 'claude_read_text_no_preview',
        matrix: makeMatrix('Read', 'Read', 'text content, no preview', 'header-only (no thumbnail)', 'partial'),
        title: 'Read (text)',
        description: 'Claude Read of a text file renders header-only with NO inline preview (no regression).',
        tool: readTextTool,
        message: makeToolMessage('codex-fixture-claude-read-text', readTextTool, 7450),
        expectedVisibleStrings: {
            inline: ['notes.txt'],
            detail: ['notes.txt', 'line one'],
            sidebar: ['notes.txt'],
        },
    },
    {
        id: 'subagent-spawn',
        matrixRow: 'subagent_lifecycle_spawn',
        matrix: makeMatrix('spawn_agent', 'functions.spawn_agent', 'subagent control lifecycle', 'completed control card'),
        title: 'spawn_agent',
        description: 'Spawn control card is completed/frozen and does not render as a long-running command.',
        tool: spawnAgentTool,
        message: makeToolMessage('codex-fixture-subagent-spawn', spawnAgentTool, 8000),
        expectedVisibleStrings: {
            inline: ['Spawn Agent', 'completed'],
            detail: ['inspect fixture rendering', 'completed'],
            sidebar: ['inspect fixture rendering', 'completed'],
        },
    },
    {
        id: 'subagent-wait',
        matrixRow: 'subagent_lifecycle_wait',
        matrix: makeMatrix('wait_agent', 'functions.wait_agent', 'subagent control lifecycle', 'completed control card'),
        title: 'wait_agent',
        description: 'Wait control card is completed/frozen with the same visible call id as its end event.',
        tool: waitAgentTool,
        message: makeToolMessage('codex-fixture-subagent-wait', waitAgentTool, 9000),
        expectedVisibleStrings: {
            inline: ['Wait for Agent', 'Wait for fixture-agent'],
            detail: ['fixture-agent', 'completed'],
            sidebar: ['fixture-agent', 'completed'],
        },
    },
    {
        id: 'subagent-close',
        matrixRow: 'subagent_lifecycle_close',
        matrix: makeMatrix('close_agent', 'functions.close_agent', 'subagent control lifecycle', 'completed control card'),
        title: 'close_agent',
        description: 'Close control card is completed/frozen with raw output in details only.',
        tool: closeAgentTool,
        message: makeToolMessage('codex-fixture-subagent-close', closeAgentTool, 10000),
        expectedVisibleStrings: {
            inline: ['Close Agent', 'Close: fixture-agent'],
            detail: ['fixture-agent', 'completed'],
            sidebar: ['fixture-agent', 'completed'],
        },
    },
    // Cycle 6 — D.5 merged subagent lifecycle card. Renders the synthetic
    // functions.subagent_lifecycle envelope. With the suppression Map active,
    // this is the ONLY card shown for sessionSubagent='codex-fixture-subagent'
    // (the spawn/wait/close cards above are suppressed). When the fixture
    // page is loaded with ?suppress=off, suppression is bypassed so all 4
    // cards render side-by-side for visual diff.
    {
        id: 'subagent-lifecycle-merged',
        matrixRow: 'subagent_lifecycle_merged',
        matrix: makeMatrix('subagent_lifecycle', 'functions.subagent_lifecycle', 'merged subagent lifecycle', 'merged lifecycle card'),
        title: 'subagent_lifecycle (merged D.5)',
        description: 'Merged subagent lifecycle card replaces the 3 spawn/wait/close cards in new sessions.',
        tool: lifecycleAgentTool,
        message: makeToolMessage('codex-fixture-subagent-lifecycle-merged', lifecycleAgentTool, 10500),
        expectedVisibleStrings: {
            inline: ['Subagent', 'fixture-agent', 'inspected fixture rendering'],
            detail: ['fixture-agent', 'completed', 'inspected fixture rendering'],
            sidebar: ['fixture-agent', 'completed', 'inspected fixture rendering'],
        },
    },
    {
        id: 'request-user-input-unavailable',
        matrixRow: 'interactive_input_unavailable',
        matrix: makeMatrix('request_user_input', 'functions.request_user_input', 'mode-limited unavailable state', 'visible reason', 'unavailable'),
        title: 'request_user_input',
        description: 'Default-mode limitation rendered as unavailable. Plan mode availability is a Codex CLI concern outside the Happy frontend.',
        tool: requestInputUnavailableTool,
        message: makeToolMessage('codex-fixture-request-user-input-unavailable', requestInputUnavailableTool, 11000),
        expectedVisibleStrings: {
            inline: ['request_user_input is only available in Plan mode'],
            detail: ['Choose a fixture option', 'unavailable'],
            sidebar: ['Choose a fixture option', 'unavailable'],
        },
    },
    {
        id: 'web-search',
        matrixRow: 'web_tool_search',
        matrix: makeMatrix('web.search_query', 'web.search_query', 'source title/snippet', 'compact result summary'),
        title: 'web.search_query',
        description: 'Web search results show title/snippet summary without raw JSON in the main flow.',
        tool: webSearchTool,
        message: makeToolMessage('codex-fixture-web-search', webSearchTool, 12000),
        expectedVisibleStrings: {
            inline: ['Example result title', 'Short source snippet'],
            detail: ['Example result title', 'Short source snippet'],
            sidebar: ['Example result title', 'Short source snippet'],
        },
    },
    {
        id: 'web-weather',
        matrixRow: 'web_tool_weather',
        matrix: makeMatrix('web.weather', 'web.weather', 'weather summary', 'compact result summary'),
        title: 'web.weather',
        description: 'Specialized web variants use the same compact fallback path.',
        tool: webWeatherTool,
        message: makeToolMessage('codex-fixture-web-weather', webWeatherTool, 13000),
        expectedVisibleStrings: {
            inline: ['San Francisco', 'Fog then sun'],
            detail: ['San Francisco', 'Fog then sun'],
            sidebar: ['San Francisco', 'Fog then sun'],
        },
    },
    {
        id: 'web-open',
        matrixRow: 'web_tool_open',
        matrix: makeMatrix('web.open', 'web.open', 'fetched page title/snippet', 'compact result summary'),
        title: 'web.open',
        description: 'Web open shows fetched page title/snippet summary alongside the URL.',
        tool: webOpenTool,
        message: makeToolMessage('codex-fixture-web-open', webOpenTool, 13500),
        expectedVisibleStrings: {
            inline: ['https://example.com/open', 'Example fetched page title', 'Short fetched content snippet'],
            detail: ['https://example.com/open', 'Example fetched page title', 'Short fetched content snippet'],
            sidebar: ['https://example.com/open', 'Example fetched page title', 'Short fetched content snippet'],
        },
    },
    // G.4 (cycle 4): web.time / web.finance / web.sports fixture parity.
    {
        id: 'web-time',
        matrixRow: 'web_tool_time',
        matrix: makeMatrix('web.time', 'web.time', 'timezone time lookup', 'compact result summary'),
        title: 'web.time',
        description: 'Time tool shows the requested timezone in the inline summary.',
        tool: webTimeTool,
        message: makeToolMessage('codex-fixture-web-time', webTimeTool, 13600),
        expectedVisibleStrings: {
            inline: ['Asia/Tokyo'],
            detail: ['Asia/Tokyo'],
            sidebar: ['Asia/Tokyo'],
        },
    },
    {
        id: 'web-finance',
        matrixRow: 'web_tool_finance',
        matrix: makeMatrix('web.finance', 'web.finance', 'finance ticker lookup', 'compact result summary'),
        title: 'web.finance',
        description: 'Finance tool shows the requested ticker symbol in the inline summary.',
        tool: webFinanceTool,
        message: makeToolMessage('codex-fixture-web-finance', webFinanceTool, 13700),
        expectedVisibleStrings: {
            inline: ['AAPL'],
            detail: ['AAPL'],
            sidebar: ['AAPL'],
        },
    },
    {
        id: 'web-sports',
        matrixRow: 'web_tool_sports',
        matrix: makeMatrix('web.sports', 'web.sports', 'sports league/team lookup', 'compact result summary'),
        title: 'web.sports',
        description: 'Sports tool shows the requested league and team in the inline summary.',
        tool: webSportsTool,
        message: makeToolMessage('codex-fixture-web-sports', webSportsTool, 13800),
        expectedVisibleStrings: {
            inline: ['NBA', 'Lakers'],
            detail: ['NBA', 'Lakers'],
            sidebar: ['NBA', 'Lakers'],
        },
    },
    // F.4 (cycle 4): playwright-data-url demonstrates the new
    // mcp__playwright__browser_navigate.extractSubtitle truncation. The
    // expectedVisibleStrings.inline contains 'data:' but deliberately omits
    // the long encoded HTML suffix so QA can grep statically.
    {
        id: 'playwright-data-url',
        matrixRow: 'playwright_long_input',
        matrix: makeMatrix('mcp__playwright__browser_navigate', 'mcp__playwright__browser_navigate', 'long data URL input', 'compact data: synopsis'),
        title: 'mcp__playwright__browser_navigate (data URL)',
        description: 'Long data URL input is folded into a short data: <mime> synopsis in the inline card; full URL accessible in details.',
        tool: playwrightDataUrlTool,
        message: makeToolMessage('codex-fixture-playwright-data-url', playwrightDataUrlTool, 13900),
        expectedVisibleStrings: {
            inline: ['data:'],
            detail: ['data:text/html', 'Playwright Long Data URL Fixture'],
            sidebar: ['data:'],
        },
    },
    // B.7 (cycle 4): image-class result with NO preview_uri AND NO
    // preview_unavailable_reason -- exercises the new staleAdvisory i18n
    // fallback at CodexAttachmentView.tsx:36.
    {
        id: 'image-stale-no-preview',
        matrixRow: 'image_attachment_stale',
        matrix: makeMatrix('functions.view_image', 'functions.view_image', 'image without preview', 'stale-message advisory', 'partial'),
        title: 'functions.view_image (stale, no preview)',
        description: 'Older messages without preview_uri or preview_unavailable_reason show a user-actionable advisory.',
        tool: imageStaleTool,
        message: makeToolMessage('codex-fixture-image-stale-no-preview', imageStaleTool, 13950),
        expectedVisibleStrings: {
            inline: ['new session', 'inline preview'],
            detail: ['new session', 'inline preview'],
            sidebar: ['new session', 'inline preview'],
        },
    },
    {
        id: 'pty-write-stdin',
        matrixRow: 'pty_write_stdin',
        matrix: makeMatrix('functions.write_stdin', 'functions.write_stdin', 'PTY stdin acknowledgement', 'compact result summary', 'partial'),
        title: 'functions.write_stdin',
        description: 'PTY streaming behavior is observable only on real Codex sessions — fixture is static by design.',
        tool: ptyWriteTool,
        message: makeToolMessage('codex-fixture-pty-write-stdin', ptyWriteTool, 14000),
        expectedVisibleStrings: {
            inline: ['stdin accepted by running PTY'],
            detail: ['hello from stdin', 'stdin accepted by running PTY'],
            sidebar: ['hello from stdin', 'stdin accepted by running PTY'],
        },
    },
    {
        id: 'mcp-resource-list-empty',
        matrixRow: 'mcp_resource_list_empty',
        matrix: makeMatrix('list_mcp_resources', 'functions.list_mcp_resources', 'empty resource list', 'visible empty state'),
        title: 'List MCP resources',
        description: 'MCP empty-list result visible through generic rendering.',
        tool: resourceListTool,
        message: makeToolMessage('codex-fixture-mcp-resource-list-empty', resourceListTool, 15000),
        expectedVisibleStrings: {
            inline: ['No MCP resources returned'],
            detail: ['Codex', 'resources'],
            sidebar: ['Codex', 'resources'],
        },
    },
    {
        id: 'mcp-resource-templates-empty',
        matrixRow: 'mcp_resource_templates_empty',
        matrix: makeMatrix('list_mcp_resource_templates', 'functions.list_mcp_resource_templates', 'empty template list', 'visible empty state'),
        title: 'List MCP resource templates',
        description: 'MCP empty-template result visible through generic rendering.',
        tool: resourceTemplatesTool,
        message: makeToolMessage('codex-fixture-mcp-resource-templates-empty', resourceTemplatesTool, 16000),
        expectedVisibleStrings: {
            inline: ['No MCP resource templates returned'],
            detail: ['Codex', 'resourceTemplates'],
            sidebar: ['Codex', 'resourceTemplates'],
        },
    },
    {
        id: 'mcp-resource-read',
        matrixRow: 'mcp_resource_read',
        matrix: makeMatrix('read_mcp_resource', 'functions.read_mcp_resource', 'resource URI/content summary', 'compact result summary'),
        title: 'Read MCP resource',
        description: 'MCP resource reads display URI/content summary with raw payload in details.',
        tool: readResourceTool,
        message: makeToolMessage('codex-fixture-mcp-resource-read', readResourceTool, 17000),
        expectedVisibleStrings: {
            inline: ['Fixture resource content'],
            detail: ['file://fixture.md', 'Fixture resource content'],
            sidebar: ['file://fixture.md', 'Fixture resource content'],
        },
    },
    {
        id: 'unknown-future-tool',
        matrixRow: 'fallback_unknown',
        matrix: makeMatrix('unknown future functions.*', 'functions.future_tool', 'unknown/error fallback', 'compact error summary', 'failure'),
        title: 'functions.future_tool',
        description: 'Unknown future tool exposes rejected/error result details.',
        tool: unknownTool,
        message: makeToolMessage('codex-fixture-unknown-future-tool', unknownTool, 18000),
        expectedVisibleStrings: {
            inline: ['functions.future_tool', 'user rejected MCP tool call', 'payload'],
            detail: ['functions.future_tool', 'user rejected MCP tool call', 'payload'],
            sidebar: ['functions.future_tool', 'user rejected MCP tool call', 'payload'],
        },
    },
];
