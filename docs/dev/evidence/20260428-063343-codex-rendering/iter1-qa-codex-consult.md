# Codex adversarial feedback

CODEX_FEEDBACK:

- The FAIL verdict is correct, but phrase it as “closure FAIL / live QA blocked,” not necessarily “implementation failed.” Automated checks passing plus a successful image build only prove the source is buildable; AC1–AC4 require live desktop/mobile evidence on the newly built app.

- Strongest blocker: running `happy-web-dev` is still old image `sha256:0cfa...`, while iter1 image is `sha256:aac5...`. Any existing screenshots/DOM metrics must be explicitly disqualified as pre-iter1/stale unless tied to the new image.

- The deploy failure is a QA procedure/hook issue, not a product bug. The report should say a sanctioned deploy/evidence rerun is required; otherwise “iteration needed” may be challenged as over-scoping if no code change is proven necessary.

- The draft underplays remaining unverified scope: BA required markdown/rich primitives, sidebar/session preview, detail panels, fallback, and mobile behavior. Unit/helper tests do not prove actual React rendering, overflow, modal/detail behavior, or MarkdownView/LaTeX correctness.

- Fixture manifest coverage appears incomplete for the original matrix: it covers patch/plan/multi-tool/image/MCP/unknown, but not clearly the concrete markdown/rich cases: headings, task lists, blockquotes, strikethrough, HTML/entities, inline LaTeX.

- Scope drift risk: iter1 changed `packages/happy-cli/src/codex/utils/sessionProtocolMapper.ts`, despite the BA spec saying app-only. This may be justified, but the QA report should explicitly flag and accept that protocol-layer change rather than treating it as invisible.

- Dirty-tree reproducibility risk: the Docker image was built from a worktree with many uncommitted/untracked files. Closure needs a source-state manifest or commit/diff accounting so reviewers know exactly what was in `sha256:aac5...`.

- Potential protocol edge cases still worth calling out:
  - `id` fallback for call pairing could attach results to the wrong tool in parallel/multi-tool sequences if `id` is not semantically a call id.
  - error-state inference from `status/success/exit/error` could false-positive on successful payloads containing an `error` field as data.
  - JSON-string output parsing may pass helper tests but still render poorly in actual full/detail/sidebar components.

- For future PASS evidence, require fresh browser context/cache-busting plus proof of loaded bundle/image identity; otherwise browser cache/service worker behavior could still show stale JS after container redeploy.

- Bottom line: keep FAIL. The draft is defensible, but strengthen it by separating “automated/source checks passed” from “acceptance criteria unmet,” and by naming stale deploy, missing live desktop/mobile evidence, markdown/rich gaps, dirty source-state risk, and protocol scope drift as closure blockers.
