# Phase A Probe Evidence — Cycle 6 (spec-20260508-211705)

**Probe method**: Static code analysis (live dev environment with active Skill/AskUserQuestion content unavailable for synchronous probe; falling back to BA-validated source-side evidence).

---

## #16 — Skill ToolFullView decision: Phase 2b (no code change needed)

**Source-evidence**: `packages/happy-app/sources/components/MessageView.tsx:133-150` (`WrappedEventBlock`):

```tsx
function WrappedEventBlock(props: { label: string; content: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasContent = props.content.length > 0;
  return (
    <View style={styles.wrappedContainer}>
      <Pressable style={styles.wrappedHeader} onPress={() => setExpanded(!expanded)}>
        <Text style={styles.wrappedLabel} numberOfLines={1}>{props.label}</Text>
        {hasContent && (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} style={styles.wrappedChevron} />
        )}
      </Pressable>
      {expanded && hasContent && (
        <View style={styles.wrappedContent}>
          <MarkdownView markdown={props.content} />
        </View>
      )}
    </View>
  );
}
```

**Analysis** vs BA spec AC-16 Phase 2b/2c branch criteria:

- **Inline state (collapsed, default)**: chip-only — only the label is rendered (`<Text style={styles.wrappedLabel} numberOfLines={1}>{props.label}</Text>`). Body is hidden behind `expanded` state. ✓ **chip-only inline**
- **Expanded state (after tap/click)**: body is rendered via `<MarkdownView markdown={props.content} />`. ✓ **body via MarkdownView in expandable surface**

This is structurally the pattern that BA AC-16 Phase 2b PASS demands: "chip-only inline + sidebar/expandable surface that displays the original prompt body via MarkdownView".

**Phase 2c trigger explicitly does NOT match**: Phase 2c trigger requires "wrap envelope inline-rendering the body in the chat list with no sidebar/expandable surface". The actual code shows the body is collapsed by default (gated on `expanded` state) — it is NOT inline-rendered alongside the chip in the chat list.

**Decision**: Phase 2b — document live-state matches the user-target shape. No code change required.

**Caveat for QA**: The BA spec §AC-16 Phase 2c also lists a "historical Skill/Command-like message from `session.metadata.slashCommands`" as a possible trigger. Those messages route through the same `WrappedEventBlock` component, so the same chip-only-collapsed + MarkdownView-on-expand behavior applies. QA can verify by:
1. Sending a slash-command in a fresh dev session
2. Confirming the wrap event card shows label only (no inline body) until tapped
3. Tapping → confirming body markdown renders inside the expanded card

---

## #14 — AskUserQuestion preview decision: Phase 2b (no code change this cycle)

**Source-evidence**: `packages/happy-app/sources/components/tools/views/AskUserQuestionView.tsx:10-13`:

```tsx
interface QuestionOption {
    label: string;
    description: string;
}
```

The current type has no `preview` field. Per BA spec, extending the type is gated on Phase 1 evidence that the CLI is actually emitting a `preview` field on at least one option.

**Without a live AskUserQuestion permission-JSON capture**, the BA spec explicitly mandates Phase 2b: "Dev does NOT modify `AskUserQuestionView.tsx` `QuestionOption` type (avoid dead field)".

**Investigation context** (consistent with BA's measurement and codex review):
- `tool.input` is typed `any` (`typesMessage.ts`) — there is NO structural barrier in the app to reading a `preview` field if the CLI emits it.
- CLI `permissionHandler.ts:255-270` forwards raw arguments — no type sanitization that would strip `preview` upstream.

**Decision**: Phase 2b — close by evidence. The user's "预览的没有任何不同" complaint maps to a feature that is not currently wired in the CLI permission JSON shape. CLI-side feature investigation deferred to Cycle 7+ (sandbox-daemon territory per CLAUDE.md "Cycle C — daemon code changes" rule).

**User-clarification recommendation for /close**: Surface this finding so user can confirm whether (a) the CLI ever did emit `preview` (potential regression), (b) the CLI was supposed to emit it (CLI feature gap), or (c) the user's complaint is a usability finding about the option-rendering UI (e.g., descriptions look identical because they ARE identical) and the fix is at the prompt-engineering layer.

---

## Probe summary

| Item | Phase | Code change this cycle? |
|------|-------|--------------------------|
| #16 | Phase 2b | No (live state already matches target shape) |
| #14 | Phase 2b | No (no `preview` field to render against; avoid dead code) |

Both decisions follow BA spec branch criteria. The #16 decision is validated by direct source-reading (`WrappedEventBlock` component code matches the AC-16 Phase 2b PASS shape). The #14 decision falls back to BA's explicit dead-code-avoidance rule when live-probe evidence is unavailable.
