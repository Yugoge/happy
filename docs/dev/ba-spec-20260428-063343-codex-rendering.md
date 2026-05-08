# BA Specification: Codex Rendering Completion

**Request ID**: 20260428-063343-codex-rendering  
**Created**: 2026-04-28T06:33:43Z  
**Revised**: 2026-04-28T07:20:00Z  
**Repository**: `/dev/shm/dev-workspace/happy-dev`

## Goal

Continue fixing happy-dev until Codex rendering is complete across every user-visible
surface, not only Terminal. The implementation scope remains app-only in happy-dev:
no production access, no daemon restart, and no non-UI session creation.

## Setup / Environment

- **viewport**: desktop `1440x900` and mobile `390x844`
- **theme**: light
- **locale**: user requirement in `zh`; app content may be mixed `en/zh`
- **auth_state**: logged-in dev account `cmi5mv9eh00wzpg14ph73jj3n`
- **data_state**: existing dev Codex sessions, including `cmohltq0n2c8rpc153k0h9pvk` and `cmoedofgz86n5nz15xsldnk35`
- **browser**: Chromium/Playwright against dev web only
- **url_path**: `/session/cmohltq0n2c8rpc153k0h9pvk` and `/session/cmoedofgz86n5nz15xsldnk35`

## Evidence (Contract A)

- **Observed**: `继续修复 happy-dev 直到彻底让 Codex 在 happy-dev 的渲染完整。`
- **Measured**:
  - `docs/dev/ba-qa-report-20260428-063343-codex-rendering.json` rejected the first BA analysis because it was Terminal/CodexBash-heavy, omitted concrete markdown/rich analysis, and used `CodexBash` as the scope seed for a broader Codex-completeness request.
  - `docs/dev/qa-report-20260427-230227-p05.json` measured the long Terminal target as still not closure-ready: hidden delta `0`, but expanded target heights `2870px` desktop and `3445px` mobile, with screenshots not proving the exact target and expanded detail not live-verified.
  - Established source localization from the current BA artifact: Codex events are emitted by `packages/happy-cli/src/codex/codexAppServerClient.ts:280-509`, mapped by `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts:294-624`, normalized by `packages/happy-app/sources/sync/typesRaw.ts:299-380,780-887,911-1158`, reduced by `packages/happy-app/sources/sync/reducer/reducer.ts:780-824,889-908,1005-1127`, and rendered through `MessageView.tsx`, `ToolView.tsx`, `_all.tsx`, `ToolFullView.tsx`, sidebar renderers, and specialized tool views.
  - Markdown/rich content was not measured by the first BA pass; QA specifically identified missing MarkdownView, LatexRenderer, parser, heading/list/task-list/blockquote/strikethrough/entity, and inline-LaTeX coverage.
- **Expected**: Each Codex payload class has bounded inline rendering, complete detail/sidebar/mobile rendering, and explicit fallback behavior. Markdown/rich content expectations come from the user’s “渲染完整” requirement plus `docs/dev/specs.pre-merge-backup/spec-20260424-084848.md` sections 5.16 and 5.17, cited by BA-QA as the repository reference for markdown primitives and inline LaTeX.
- **Gap**: The previous BA analysis proved a real Terminal blocker but did not prove Codex completeness. Non-Terminal payload classes are now treated as explicit scope rows with evidence status `measured broken`, `source-localized risk`, or `not yet measured`. Any `not yet measured` row is a QA closure blocker until live desktop and mobile evidence exists.

## Payload-by-Surface Matrix

| Payload / surface | Inline card | Detail panel | Sidebar / session preview | Mobile | Fallback / unknown | Evidence status | Affected renderer paths |
|---|---|---|---|---|---|---|---|
| Markdown/rich Codex text/final | Must render markdown primitives without flattening | Detail must preserve rich content and scrolling | Preview must not expose raw syntax except intentionally | Must preserve headings/lists/code/links/LaTeX within viewport | N/A for text | **Not yet measured; critical scope gap** | `MarkdownView`/markdown parser/`LatexRenderer` paths under `packages/happy-app/sources/components/**`, plus `MessageView.tsx` |
| Terminal stdout/stderr/exit (`commandExecution`, `CodexBash`) | Bounded summary; no page overflow | Command once, normalized, stdout/stderr/exit reachable | Sidebar command/output normalized and scrollable | Same proof at `390x844` | Generic fallback if unknown shape | **Measured broken / unverified detail** | `CodexBashView.tsx`, `ToolFullView.tsx`, `SidebarBashView.tsx`, `CommandView.tsx`, `CodeView.tsx`, `toolCommand.ts` |
| Patch/diff (`fileChange`, `turn_diff`, `CodexPatch`, `CodexDiff`) | Compact file/status summary | Full diff or patch result reachable | Preview shows file/action, not raw JSON only | Horizontal/vertical scroll discoverable | Generic object fallback if parser misses | Source-localized risk | `views/_all.tsx`, patch/diff specialized views, `ToolFullView.tsx`, `SidebarContentRenderer.tsx`, `CodeView.tsx` |
| Plan/update (`update_plan`, plan messages) | Current steps and statuses visible | Full plan history/detail visible | Preview identifies plan update | Mobile preserves step labels/status | Generic tool fallback if unsupported | Source-localized risk | plan/update specialized view if present, `knownTools.tsx`, generic tool/detail renderers |
| Dynamic/MCP/resource tools (`functions.*`, `mcp__*`, resource helpers) | Tool name, arguments summary, state | Full arguments/result/error visible | Preview identifies server/tool/action | Mobile detail reachable | Unknown tools bounded and readable | Source-localized risk | `ToolView.tsx`, `ToolFullView.tsx`, `SidebarGenericView.tsx`, `SidebarContentRenderer.tsx`, `knownTools.tsx` |
| Image/attachment (`imageView`, view-image helpers) | Thumbnail or attachment affordance visible | Full image/metadata/error shown | Preview indicates image/attachment | Mobile image not clipped or invisible | Text fallback for missing asset | Not yet measured | image specialized view path under `components/tools/views/**`, `ToolFullView.tsx`, sidebar renderer |
| Multi-tool sequences (`multi_tool_use.parallel`, collab-agent functions) | Sequence children/state not collapsed into noise | Each child tool/result discoverable | Preview indicates sequence progress | Mobile sequence navigation works | Generic sequence fallback readable | Not yet measured | reducer child-message handling, `ToolView.tsx`, generic/detail/sidebar renderers |

## Scope (Contract B)

- **Search patterns**: `Codex`, `commandExecution`, `CodexBash`, `fileChange`, `turn_diff`, `functions.`, `mcp__`, `update_plan`, `plan`, `imageView`, `terminal-output`, `multi_tool_use`, `MarkdownView`, `LatexRenderer`, `markdown`, `SidebarContentRenderer`, `ToolFullView`, `knownTools`.
- **Search scope**: `packages/happy-app/sources/**`, with protocol context from `packages/happy-cli/src/codex/**` and `packages/happy-wire/src/**`.
- **User reported**: Codex rendering incomplete in happy-dev; no specific source file named.
- **Additional found / required**: Terminal, markdown/rich text, image/attachment, plan/update, dynamic/MCP/resource, patch/diff, generic fallback, sidebar, mobile, and multi-tool sequence renderers.
- **Fresh inspection note**: a local broad grep attempt was blocked by the Bash consecutive-use gate. This revised spec therefore uses the already-read BA/QA artifacts and marks unresolved renderer paths as `verify before edit`, not as proven line numbers.

## Reference Source (Contract C)

- **Tier**: `tier_2_verified`
- **Source**: user requirement, BA-QA report, p05 QA runtime artifact, established source localization in the existing BA context, and reference spec sections 5.16/5.17 for markdown/rich cases.
- **Copy allowed**: yes for behavior requirements; no for treating prior failed implementation as sufficient proof.
- **Dev constraint**: Dev may change only happy-app/happy-dev source for this cycle. Closure requires QA live evidence; source, bundle grep, and typecheck are not sufficient.

## Prior Attempts (Contract D)

- **Triggered**: yes — user wording `继续修复 / 彻底 / 渲染完整`, prior Codex rendering artifacts, and BA-QA rejection.
- **Attempt 1**: generic tool detail work fixed older generic cases but did not cover Codex Terminal/detail. Category `wrong_scope`, layer L2.
- **Attempt 2**: Codex protocol/dormant renderer cycles activated mappings but left p03/p04 deferred and p02 conditional. Category `wrong_scope`, layer L3/L4.
- **Attempt 3**: p05 long Terminal focus treated inline clipping but did not prove expanded Terminal/detail and produced a failed QA artifact. Category `symptom_treatment`, layer L1/L2.
- **Attempt 4**: first BA analysis for this request scoped broadly in prose but kept evidence/search centered on CodexBash and omitted markdown/rich concrete analysis. Category `wrong_scope`, layer L2.

**Novelty check**: This revision targets the broader L2 renderer matrix plus L4 normalization where necessary. It is not a Terminal-only cycle.

## Requirements (MoSCoW)

### Must Have

- Implement and verify Codex rendering for every matrix row: markdown/rich text, Terminal, patch/diff, plan/update, dynamic/MCP/resource tools, image/attachment, multi-tool sequences, and fallback/unknown.
- Preserve already-bounded inline Terminal behavior while making expanded Terminal/detail/sidebar complete.
- Add concrete markdown/rich acceptance cases: headings, lists, task lists, blockquotes, strikethrough, code, links, HTML/entities, and inline LaTeX.
- Keep fallback generic rendering bounded, readable, and discoverable on desktop and mobile.
- Produce QA live evidence on desktop `1440x900` and mobile `390x844`; expanded Terminal/detail remains a closure blocker until exact-target screenshots and DOM metrics pass.
- Stay within happy-app/happy-dev; no daemon restart, production URL/port/service access, or non-UI session creation.

### Should Have

- Add focused app-level tests for command normalization, markdown/rich renderer routing, and generic fallback summaries.
- Produce an evidence manifest mapping each matrix row to screenshots, DOM metrics, console/network status, and source commit.

### Won't Have

- No happy-cli daemon deployment/restart in this cycle.
- No production `life-ai.app`, `localhost:8090`, or production API access.
- No closure from source-only review.

## Requirements Decomposition

| ID | Source phrase | Acceptance criterion |
|---|---|---|
| R1 | “继续修复 happy-dev” | Only happy-dev app artifacts and dev evidence are changed; production and daemons remain untouched. |
| R2 | “直到彻底让 Codex … 渲染完整” | Every matrix row has a pass result or an explicit intentionally-hidden rationale; unmeasured rows block closure. |
| R3 | “Markdown and rich Codex content need concrete analysis” | Markdown/rich source paths, cases, and desktop/mobile evidence are included. |
| R4 | “Scope cannot be centered only on CodexBash” | Scope expansion uses all listed Codex patterns, not only `CodexBash`. |
| R5 | “Terminal/detail live verification remains a closure blocker” | Expanded Terminal/detail/sidebar has exact-target desktop/mobile screenshots and metrics before closure. |

## Acceptance Criteria

### AC1: Matrix completeness
- GIVEN a dev Codex session with representative payloads
- WHEN QA opens inline, detail/sidebar, and mobile surfaces
- THEN every matrix row is evidenced as pass or intentionally hidden
- AND no unmeasured payload class is used as closure proof.

### AC2: Markdown/rich content
- GIVEN Codex text/final content containing headings, lists, task lists, blockquotes, strikethrough, code, links, HTML/entities, and inline LaTeX
- WHEN viewed inline and in detail/mobile
- THEN the rich content is rendered correctly without raw JSON leakage or viewport overflow.

### AC3: Expanded Terminal/detail
- GIVEN the long Terminal target from `cmohltq0n2c8rpc153k0h9pvk`
- WHEN opened in desktop detail/sidebar and mobile detail/modal
- THEN command text appears once, stdout/stderr/exit status are reachable, no page-level horizontal overflow occurs, and screenshots/DOM metrics prove the exact target.

### AC4: Non-Terminal tools and fallback
- GIVEN patch/diff, image/attachment, plan/update, dynamic/MCP/resource, and multi-tool payloads
- WHEN rendered inline/detail/sidebar/mobile
- THEN specialized views are used where available and the fallback view remains bounded, readable, and non-lossy for unknown tools.

## Technical Hints

- Known Terminal/detail candidates: `packages/happy-app/sources/components/tools/views/CodexBashView.tsx`, `packages/happy-app/sources/components/tools/ToolFullView.tsx`, `packages/happy-app/sources/components/sidebar/SidebarBashView.tsx`, `packages/happy-app/sources/utils/toolCommand.ts`, `CommandView.tsx`, `CodeView.tsx`.
- Broader renderer candidates to verify before editing: markdown `MarkdownView`/parser/`LatexRenderer` under `packages/happy-app/sources/components/**`, image view under `packages/happy-app/sources/components/tools/views/**`, plan/update view if present, `SidebarContentRenderer.tsx`, `SidebarGenericView.tsx`, `knownTools.tsx`, `views/_all.tsx`, `ToolView.tsx`.
- Dev must first read/resolve exact paths; BA did not authorize blind edits to candidate paths.
- QA evidence is separate from implementation: dev may typecheck/test, but QA must rebuild/deploy happy-web-dev and capture live desktop/mobile proof.
