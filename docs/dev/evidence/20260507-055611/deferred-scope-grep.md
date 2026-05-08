### source parser scope quick probes (#10/#11 deferred still not implemented by parser shape)
packages/happy-app/sources/components/markdown/parseMarkdownSpans.ts:29:    const urlPattern = /https?:\/\/[^\s<]+/g;
packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:8:const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:85:function extractTableRows(tableLines: string[]): string[][] {
packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts:86:    const rows: string[][] = [];
packages/happy-app/sources/components/markdown/MarkdownView.tsx:433:    headers: string[], rows: string[][], selectable: boolean, onLinkPress: (url: string) => void,
packages/happy-app/sources/components/markdown/MarkdownView.tsx:465:    rows: string[][], rowCount: number, selectable: boolean, onLinkPress: (url: string) => void,
packages/happy-app/sources/components/markdown/MarkdownView.tsx:489:    headers: string[], rows: string[][], selectable: boolean, first: boolean, last: boolean,
packages/happy-app/sources/components/markdown/MarkdownView.tsx:510:    headers: string[], rows: string[][], onLinkPress: (url: string) => void,
