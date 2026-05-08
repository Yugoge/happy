# BA Specification: Codex/Claude Transcript Rendering Parity — R3 QA Amendment

**Request ID**: 20260428-112122-codex-claude-transcript-parity  
**Created**: 2026-04-28T11:21:22Z  
**Revised**: 2026-04-28T12:32:08Z  
**Repository**: `/dev/shm/dev-workspace/happy-dev`

## Goal

Revise the single Codex-vs-Claude transcript parity issue so Dev can fix data loss before UI polish: Codex Bash/tool-call content and Codex subagent lifecycle/content must render like current Claude Code Bash and Agent/Task behavior in Happy dev. R3 additionally closes the app-server lifecycle contract: child subagent `final_answer` events are child content/result only and must not complete or clear the parent/root turn.

## Setup / Environment

- **viewport**: desktop `1440x900` and mobile `390x844`
- **theme**: light primary; no dark-mode regression in shared components
- **locale**: requirement in `en`; session content may include `en`/`zh`
- **auth_state**: logged-in Happy dev account `cmi5mv9eh00wzpg14ph73jj3n`
- **data_state**: existing dev sessions plus samples created through the normal dev UI only; no API-created sessions
- **browser**: Chromium/Chrome against dev web only
- **url_path**: known Codex Bash sample `/session/cmohltq0n2c8rpc153k0h9pvk`; Claude Bash+Agent and Codex subagent sample routes remain QA preconditions

## Evidence (Contract A)

- **Observed**: User asks: “Happy dev transcript rendering for Bash/tool-call content and subagent lifecycle/content should match current Claude Code rendering when the underlying session source is Codex.” QA rejected the prior BA for unresolved subagent propagation, result transport, test, and verification contracts; the second QA rejection narrows the remaining blocking gap to child subagent `final_answer` events being able to emit top-level completion.
- **Measured**:
  - Codex app-server emits command completion fields at `packages/happy-cli/src/codex/codexAppServerClient.ts:315-327`, but mapper drops them at `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts:324-328`.
  - `tool-call-end` currently has only optional string `output` in both `packages/happy-wire/src/sessionProtocol.ts:41-45` and `packages/happy-app/sources/sync/typesRaw.ts:59-63`; normalization maps missing output to `content:null,is_error:false` at `typesRaw.ts:664-680`.
  - Codex item notifications carry wrapper `threadId`/`turnId` (`/tmp/codex-ts/v2/ItemCompletedNotification.ts:6`), and `ThreadItem` shows `agentMessage` has text/phase while `collabAgentToolCall` has `senderThreadId` and `receiverThreadIds` (`/tmp/codex-ts/v2/ThreadItem.ts:26,64-101`). Current app-server does **not** forward wrapper `threadId` for `commandExecution` or `agentMessage` (`codexAppServerClient.ts:302-327,364-372`).
  - Current app-server treats any completed `agentMessage.phase === 'final_answer'` as root turn completion: `codexAppServerClient.ts:364-381` calls `emitRawTurnCompletion`, and `emitRawTurnCompletion` clears `_turnId` and emits top-level `task_complete`/`turn_aborted` at `codexAppServerClient.ts:214-247`; the Codex mapper converts `task_complete` to `turn-end` and clears `currentTurnId` at `codex/utils/sessionProtocolMapper.ts:236-260`.
  - Claude source-of-truth links hidden parent Agent/Task cards to child sidechains by using one CUID2 as visible call id, `args.sessionSubagent`, `envelope.subagent`, and tool-result call id (`claude/utils/sessionProtocolMapper.ts:547-594,771-794`). App tracer links that CUID2 through `toolCallToMessageId` to the parent normalized message id (`reducerTracer.ts:121-127,185-199,260-272`); reducer storage remains keyed by the traced parent message/sidechain id (`reducer.ts:947-959,1133-1155`), so parity requires correct lookup/linkage, not a reducer-key refactor.
  - Prior runtime evidence reports the long Codex Terminal target textLength `8608` and heights `2870px` desktop / `3445px` mobile, with screenshot mismatch (`docs/dev/qa-report-20260427-230227-p05.json:27-60,230-279`).
- **Expected**: Codex transports structured command result and child-thread identity through app-server → mapper → protocol schema → normalizer → reducer/sidebar using Claude’s current Bash/Agent contract as tier-2 verified oracle. Only root/current-thread `final_answer` or actual root `turn/completed` may complete the root turn; known receiver child-thread `final_answer` must remain child transcript/result content and must not emit top-level `task_complete`/`turn-end` or clear parent linkage.
- **Gap**: The previous BA expected UI/reducer parity from data that is currently lost before the mapper or rejected by schemas; R2 QA additionally showed child `final_answer` can prematurely close/misattribute the parent turn unless app-server completion is gated by root-vs-child thread identity.

## Scope (Contract B)

- **Search pattern**: `exec_command_end|collab_agent_call|CodexBash|functions.spawn_agent|SidebarAgentConversation|sessionSubagent|tool-call-end|final_answer|emitRawTurnCompletion|task_complete|turn-end`
- **Search scope**: `packages/**` runtime and focused tests; docs are prior-attempt evidence only.
- **User reported**: Happy dev Codex Bash/tool-call and subagent transcript parity with Claude Code.
- **Additional found**: wrapper `threadId` omission, string-only `tool-call-end`, app-server root-vs-child `final_answer` completion gap, missing `functions.spawn_agent` sidebar routing, test underclassification, and p05 exact-element evidence gaps.
- **Implementation targets**: `codexAppServerClient.ts` root/child thread propagation plus `final_answer` completion gating, Codex mapper/tests, `happy-wire` protocol/tests, app `typesRaw`/tests, reducer tracer/reducer tests, Codex Bash/subagent renderers, sidebar routing, and focused utility tests. `packages/happy-cli/src/codex/runCodex.ts` is contextual Ink-buffer evidence only unless Dev intentionally updates local CLI display.

## Reference Source (Contract C)

- **Tier**: `tier_2_verified` for local Claude mapper/renderers and app reducer behavior; `/tmp/codex-ts/v2/*` is generated local Codex protocol evidence for available raw fields.
- **Copy allowed**: yes for behavior/data-flow shape; no for stale comments or dormant/fallback wording.
- **Locations**: `claude/utils/sessionProtocolMapper.ts:383-419,547-594,771-794`; `BashView.tsx:44-80`; `TaskView.tsx:33-52`; `SidebarAgentConversation.tsx:161-191`.

## Prior Attempts (Contract D)

Triggered by dedup, related commits, and QA rejection. Prior cycles either improved Claude Agent/Task, activated broad/dormant Codex renderers, or treated Codex terminal overflow at L1/L2. This amendment targets L4 transport/linkage/lifecycle first, then L2 rendering. It is novel because it requires upstream app-server thread/result propagation plus root-vs-child `final_answer` completion gating and schema/normalizer/reducer golden tests, not mapper-only or UI-only changes. R2 QA specifically blocks handoff until child `final_answer` is forbidden from producing top-level `task_complete`/`turn-end`.

## Requirements (MoSCoW)

### Must Have
- Codex app-server must preserve wrapper `threadId`/`turnId` for every item event family that can render as transcript content: `agentMessage`, `commandExecution`, `fileChange`, `dynamicToolCall`, `mcpToolCall`, `plan`, `imageView`, and `collabAgentToolCall`. Mapper envelopes must prefer wrapper `turnId` when present so child events are not dropped for missing/current turn state.
- Thread-to-subagent mapping must be gated: only receiver child thread ids learned from `collabAgentToolCall.receiverThreadIds[]` map to `envelope.subagent`; root/current-thread events remain top-level and must not create sidechains merely because they have a wrapper `threadId`.
- App-server final-answer lifecycle must also be gated by root-vs-child thread identity: a `final_answer` from a known receiver child thread is child transcript/result content only and must **not** call `emitRawTurnCompletion`, emit top-level `task_complete`, produce mapper `turn-end`, clear `_turnId`/`currentTurnId`, or clear the `callId -> child CUID2`/parent linkage. Root/current-thread `final_answer` and actual root `turn/completed` remain valid root turn completion signals and must complete exactly once.
- Extend session protocol transport with explicit structured result for command/Bash completion (e.g. `tool-call-end.result` while retaining legacy `output`). Raw metadata/stringified JSON alone is not acceptable. Codex Bash result must include `output`, `stdout`, `stderr`, `exit_code`, `status`, `duration_ms`, `cwd`, `command`, `empty_output`, `source`.
- Enforce identity linkage for Codex spawn without refactoring reducer keys: visible parent card id and `args.sessionSubagent` use the child CUID2; child `envelope.subagent`/`parentUUID` use that CUID2; `reducerTracer.toolCallToMessageId` maps the CUID2 to the parent message id; `state.sidechains` continues using the existing parent message/sidechain id. `senderThreadId` is parent/control-plane context; first usable `receiverThreadIds[]` is the target child provider id.
- Result/summary display is scoped to data that exists: child final answer comes from child `agentMessage.phase === 'final_answer'` with matching child thread id. `collab_agent_call_end` status alone is not text; completion must maintain or propagate `callId -> child CUID2`, and tests must cover final-answer-before-end and end-before-final-answer ordering.
- Spawn-agent parent result must remain a displayable string final answer or its renderer must be explicitly updated; the structured object result requirement applies to Bash/commandExecution and must not break `SidebarAgentConversation` result rendering.
- Golden tests are mandatory for app-server propagation, root-vs-child thread gating, child-`final_answer` no-completion gating, root-`final_answer` still-completes-once behavior, wrapper `turnId` envelope attribution, mapper/wire/app schema parsing, normalizer result objects, reducer sidechain linkage, ordering permutations, empty/failure Bash states, and sidebar route selection.
- QA closure requires live dev UI evidence on desktop and mobile after changes are loaded into a dev web surface. BA performs no deployment; downstream may use local/HMR dev web or safe `happy-web-dev` rebuild/deploy only when allowed by the current workflow. Production deployment and source-only fallback are forbidden.

### Should Have
- Reuse shared Bash/Task primitives without weakening Claude behavior.
- Keep raw provider ids in dev/raw detail only, not primary labels.

### Won't Have
- No production domains/services/images, daemon lifecycle changes by subagents, API-created sessions, or generic Codex cleanup outside Bash/subagent parity.

## Requirements Decomposition

| ID | Source phrase | Acceptance criterion |
|---|---|---|
| R1 | “Bash/tool-call content” | Codex command start/end fixtures yield structured result, failure/empty states, bounded inline preview, and full detail/sidebar output. |
| R2 | “subagent lifecycle/content” | Codex child thread identity propagates for text and all child transcript item families, root-thread events stay top-level, child `final_answer` never emits top-level `task_complete`/`turn-end`, and one Claude-equivalent child conversation renders prompt, child text/tools, lifecycle/status, and final answer when available. |
| R3 | “should match current Claude Code rendering” | Claude Bash and Agent/Task remain unchanged and define parity matrix. |
| R4 | “Happy dev” | Evidence uses dev routes/account only; sessions are UI-created when new samples are needed. |

## Acceptance Criteria

### AC1: Structured Codex Bash transport
- GIVEN `exec_command_begin/end` raw events for success, nonzero exit, failed/declined status, empty output, and long output
- WHEN app-server, mapper, wire schema, app normalizer, and reducer golden tests run
- THEN the resulting `ToolCall.result` is a structured object with required fields, correct `state`, correct `empty_output`, and no lossy metadata-only transport.

### AC2: Codex subagent identity/linkage
- GIVEN a `collabAgentToolCall` spawn with `senderThreadId`, `receiverThreadIds[0]`, child `agentMessage`, child `commandExecution`, child `fileChange`/dynamic/MCP/plan/image item events, and root-thread item events
- WHEN mapped and reduced with wrapper `turnId` present
- THEN only receiver child threads receive `envelope.subagent`; root/current-thread events remain top-level; the child CUID2 maps through `toolCallToMessageId` to the parent message sidechain; child transcript content appears in one sidebar/detail conversation; control verbs do not create unrelated sidebar conversations.

### AC2b: Subagent final-answer lifecycle and completion ordering
- GIVEN a root/current Codex turn, a spawned receiver child thread, collab begin/end, child `agentMessage.phase === 'final_answer'` events in both orders (final answer before end, and end before final answer), and a separate root/current-thread final answer or root `turn/completed` signal
- WHEN app-server, mapper, and reducer golden tests run
- THEN the child final answer is emitted only as child transcript/result content using the same child CUID2 linkage; it emits **no** top-level `task_complete`, produces **no** mapper `turn-end`, does **not** clear `_turnId`/`currentTurnId`, and does **not** clear parent/child linkage.
- AND the spawn-agent parent completion has a displayable string final answer when available, never invents text from status-only `collab_agent_call_end`, and converges for both ordering permutations.
- AND the root/current-thread final answer or root `turn/completed` still emits exactly one top-level completion/`turn-end` for the root turn.

### AC3: Live UI parity and non-regression
- GIVEN the changed bundle is loaded in a dev web surface
- WHEN QA opens representative Codex Bash, Codex subagent, Claude Bash, and Claude Agent/Task sessions at `1440x900` and `390x844`
- THEN screenshots plus DOM metrics show bounded inline previews, reachable full output, one subagent conversation, no provider-id label leakage, and no Claude regression.

## Technical Hints

- Do not remove `ToolFullView.tsx:21-29` duplicate-command guard or broad top-level lifecycle drop without replacing it with narrower tested behavior.
- App-server tests must include a collab spawn whose child receiver thread emits `agentMessage.phase=final_answer` before the root final answer; assert the child event produces child content but zero `task_complete` until root completion. Mapper tests must assert zero `turn-end` for child final answer and one `turn-end` for root completion. Reducer/sidebar tests must assert parent sidechain linkage survives child final-answer arrival.
- `SidebarContentRenderer.tsx:20-30` currently routes only `Task`/`Agent` to `SidebarAgentConversation`; Codex spawn parity must address this.
- Open validation preconditions: QA must locate or UI-create Claude Bash+Agent and Codex subagent sample routes. If unavailable, QA blocks with precondition failure, not source-only PASS.

## QA Objections Addressed

OBJ-1..OBJ-10 are resolved in `docs/dev/ba-qa-response-20260428-112122-codex-claude-transcript-parity.json`: app-server propagation is required, `codexAppServerClient.ts` is in scope, Bash structured result transport is named, tests are Must Have, verification wording is dev-only/non-production, subagent result source/order is scoped to child final-answer data, identity linkage avoids reducer-key refactors, preconditions are listed, p05 evidence is linked, and `runCodex.ts` is non-target.

R2-OBJ-1..R2-OBJ-3 are resolved in this R3 amendment: root-vs-child `final_answer` completion gating is now in scope/root cause/Must Have/AC2b/verification, the stale CUID2 identity false flag is removed in favor of lookup-linkage wording, and the BA response summary no longer uses draft-amendment wording.

## Prior Codex Review Incorporated (historical; not repeated for R3)

No external/adversarial consultation was performed for this R3 amendment per the user instruction to use the QA report and repository evidence only. Historical adversarial Codex review from the previous amendment identified seven additional risks and they remain incorporated: (1) CUID2 is a linkage id, not necessarily the reducer storage key; (2) root/current-thread events must not be sidechained; (3) all child item families, not only Bash/text, need thread identity; (4) collab end must preserve `callId -> child CUID2` or equivalent receiver mapping; (5) wrapper `turnId` must be used when present; (6) Bash may use structured result objects but spawn-agent final answers must remain displayable strings or renderer support must be explicit; (7) artifact status is finalized from draft to ready.
