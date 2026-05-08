### git status target files
 M packages/happy-app/sources/components/markdown/MarkdownView.tsx
 M packages/happy-app/sources/components/markdown/parseMarkdown.test.ts
 M packages/happy-app/sources/components/markdown/parseMarkdownSpans.ts
?? .claude/specs/spec-20260506-203755/cp-state-dev.json
?? docs/dev/dev-report-20260507-055611.json
?? docs/dev/specs/spec-20260506-203755.md

### changed files diff name-only (target slice + scope check)
docs/dev/INDEX.md
docs/dev/README.md
docs/dev/specs/INDEX.md
packages/happy-app/sources/app/(app)/_layout.tsx
packages/happy-app/sources/app/(app)/dev/index.tsx
packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].tsx
packages/happy-app/sources/components/AgentInput.tsx
packages/happy-app/sources/components/CodeView.tsx
packages/happy-app/sources/components/CommandView.tsx
packages/happy-app/sources/components/INDEX.md
packages/happy-app/sources/components/SessionActionsNativeMenu.android.tsx
packages/happy-app/sources/components/markdown/MarkdownView.tsx
packages/happy-app/sources/components/markdown/parseMarkdown.test.ts
packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts
packages/happy-app/sources/components/markdown/parseMarkdownSpans.ts
packages/happy-app/sources/components/modelModeOptions.ts
packages/happy-app/sources/components/sidebar/SidebarAgentConversation.tsx
packages/happy-app/sources/components/sidebar/SidebarBashView.tsx
packages/happy-app/sources/components/sidebar/SidebarContentRenderer.tsx
packages/happy-app/sources/components/sidebar/SidebarFileView.tsx
packages/happy-app/sources/components/sidebar/SidebarGenericView.tsx
packages/happy-app/sources/components/tools/ToolFullView.tsx
packages/happy-app/sources/components/tools/ToolView.tsx
packages/happy-app/sources/components/tools/knownTools.tsx
packages/happy-app/sources/components/tools/views/CodexBashView.tsx
packages/happy-app/sources/components/tools/views/CodexDiffView.tsx
packages/happy-app/sources/components/tools/views/CodexParallelView.tsx
packages/happy-app/sources/components/tools/views/CodexPatchView.tsx
packages/happy-app/sources/components/tools/views/CodexSubagentView.tsx
packages/happy-app/sources/components/tools/views/_all.tsx
packages/happy-app/sources/sync/localSettings.ts
packages/happy-app/sources/sync/modeHacks.ts
packages/happy-app/sources/sync/reducer/reducer.spec.ts
packages/happy-app/sources/sync/reducer/reducerTracer.spec.ts
packages/happy-app/sources/sync/settings.spec.ts
packages/happy-app/sources/sync/typesRaw.spec.ts
packages/happy-app/sources/sync/typesRaw.ts
packages/happy-app/sources/text/translations/en.ts
packages/happy-cli/src/codex/__tests__/executionPolicy.test.ts
packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts
packages/happy-cli/src/codex/codexAppServerClient.test.ts
packages/happy-cli/src/codex/codexAppServerClient.ts
packages/happy-cli/src/codex/codexAppServerTypes.ts
packages/happy-cli/src/codex/executionPolicy.ts
packages/happy-cli/src/codex/runCodex.ts
packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts
packages/happy-wire/src/sessionProtocol.test.ts
packages/happy-wire/src/sessionProtocol.ts

### scope diff stats for target files
 .../sources/components/markdown/MarkdownView.tsx   |  38 +++--
 .../components/markdown/parseMarkdown.test.ts      | 106 ++++++++++++-
 .../components/markdown/parseMarkdownSpans.ts      | 168 +++++++++++++++------
 3 files changed, 254 insertions(+), 58 deletions(-)

### forbidden subsystem diff name matches
packages/happy-app/sources/components/AgentInput.tsx
packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts
packages/happy-app/sources/components/modelModeOptions.ts
packages/happy-app/sources/components/tools/ToolView.tsx
packages/happy-app/sources/components/tools/knownTools.tsx
packages/happy-app/sources/sync/typesRaw.spec.ts
packages/happy-app/sources/sync/typesRaw.ts
