// Maps markdown language identifiers to file extensions for code block downloads.
const LANGUAGE_TO_EXTENSION: Record<string, string> = {
    typescript: 'ts',
    ts: 'ts',
    javascript: 'js',
    js: 'js',
    tsx: 'tsx',
    jsx: 'jsx',
    python: 'py',
    py: 'py',
    rust: 'rs',
    rs: 'rs',
    go: 'go',
    java: 'java',
    kotlin: 'kt',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    'c#': 'cs',
    csharp: 'cs',
    ruby: 'rb',
    rb: 'rb',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yml',
    toml: 'toml',
    xml: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    bash: 'sh',
    sh: 'sh',
    zsh: 'sh',
    fish: 'fish',
    powershell: 'ps1',
    ps1: 'ps1',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    markdown: 'md',
    md: 'md',
    r: 'r',
    scala: 'scala',
    elixir: 'ex',
    ex: 'ex',
    erlang: 'erl',
    haskell: 'hs',
    lua: 'lua',
    perl: 'pl',
    pl: 'pl',
    dart: 'dart',
    svelte: 'svelte',
    vue: 'vue',
    diff: 'diff',
    patch: 'patch',
    ini: 'ini',
    tf: 'tf',
    terraform: 'tf',
    proto: 'proto',
};

export function getFileExtension(language: string | null): string {
    if (!language) return 'txt';
    const normalized = language.toLowerCase().trim();
    return LANGUAGE_TO_EXTENSION[normalized] ?? 'txt';
}

// Triggers a browser file download with the given content and derived filename.
// Only works on web (requires document and URL.createObjectURL).
export function downloadCodeOnWeb(content: string, language: string | null): void {
    if (typeof document === 'undefined') return;
    const ext = getFileExtension(language);
    const filename = `code.${ext}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}
