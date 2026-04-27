# Runtime DOM Walk — Section 5.3 Right Detail Panel Bash Popup

**Captured**: 2026-04-25T20:18Z
**Session**: cmoedofgz86n5nz15xsldnk35
**Tool call clicked**: "List dev spec files and confirm" (long ls command)
**Viewport**: 390 x 844 (mobile path; RNModal pageSheet)

## Method

Captured 12-deep DOM ancestor chain from the text node containing the long bash
command up to the `[role="dialog"]` modal root. For each level, recorded:
boundingRect, scrollWidth, clientWidth, computed `overflow-x`, `whiteSpace`,
`wordBreak`, `flexWrap`, `display`, `flex`, `width`, `maxWidth`.

## Key measurements

| depth | element | width | clientWidth | scrollWidth | overflowX | role |
|-------|---------|-------|-------------|-------------|-----------|------|
| 0 | Text (commandText) | 1065 | 1065 | 1065 | visible | the command string |
| 1 | View (line, flexDirection: row) | 1077 | 1077 | 1077 | visible | CommandView's line wrapper |
| 2 | View (CommandView container) | 1109 | 1109 | 1109 | **hidden** | CommandView root, padding:16 |
| 3 | View (commandWrapper inner) | 1109 | 1109 | 1109 | visible | scroll content child |
| 4 | View (commandWrapper outer? styles.commandWrapper) | 1109 | 1109 | 1109 | visible | flex:1, minWidth:100% |
| **5** | **ScrollView outer (horizontal)** | **390** | **390** | **1109** | **auto** | **the actual SidebarBashView ScrollView** |
| 6 | View (SidebarBashView styles.container) | 390 | 390 | 390 | visible | flex:1, paddingTop:12 |
| 7-9 | SidebarLayer / SidebarContentStack wrappers | 390 | 390 | 390 | visible | mounting layers |
| 10 | dialog inner content | 390 | 390 | 390 | visible | RNModal child |
| 11 | dialog root [role="dialog"] | 390 | 390 | 390 | visible | RNModal pageSheet |

## Critical findings

1. **Depth 5 IS the popup-bounded scroll container.** It has `clientWidth=390`
   matching the popup (RNModal pageSheet width on mobile), `scrollWidth=1109`,
   `overflow-x: auto`. This is the SidebarBashView's `<ScrollView horizontal>`.
2. **The Cycle 5 audit's claim that "depth-5 is an outer ancestor, not the
   panel" is partially incorrect.** Depth 5 IS the panel-bounded ScrollView.
   However, the audit's underlying observation (user sees command extending
   beyond visible popup width) is still valid — see point 3.
3. **The bug visible to the user is NOT "ScrollView fails to scroll" — it is
   "scroll affordance is invisible/non-discoverable on web mobile."**
   - On web mobile (RNModal pageSheet), React Native's ScrollView with
     `showsHorizontalScrollIndicator={true}` only shows the scrollbar during
     active touch/scroll. At rest, the user sees text appearing to be cut off
     at the popup's right edge with no visible indication that more content is
     scrollable.
4. **Confirmed via cycle 5 desktop.png**: on desktop (1280 viewport, 450px
   sidebar), the command text VISUALLY extends past the popup's right edge AND
   past the viewport's right edge. The popup-bounded ScrollView either fails
   to clip (because no parent has `overflow: hidden` on the desktop side
   panel) or the scrollbar is invisible by default.
5. **The cycle 1 fix (remove `flexWrap: 'wrap'` and `flex: 1` from CommandView)
   is still in place** — verified by reading current `CommandView.tsx:42-58`.
   Lines 42-45 (`line: { alignItems: 'baseline', flexDirection: 'row' }`)
   and 53-58 (`commandText: { fontFamily, fontSize, color, lineHeight }`) no
   longer have flexWrap or flex:1. The cycle 1 fix is doing what it was
   designed to do: enable horizontal scroll. The PROBLEM is the scroll
   affordance is invisible.

## Layer classification

- Cycle 1 attempt: **L1 cosmetic** (removed two style properties from
  CommandView) — landed and works as designed but doesn't address user's
  actual concern.
- The right next move is **L2 structural** — change SidebarBashView's wrapper
  approach so the command text is either visibly wrappable or has a guaranteed
  visible scroll indicator on web. Hardware-keyboard users on desktop also
  cannot trigger the touch-only scrollbar reveal.

## Recommended L2 structural fix

Change SidebarBashView to render the command in a **wrap-mode** instead of a
horizontal-scroll mode. The popup is already narrow (450px desktop / 390px
mobile); horizontal-only scroll for terminal text is hostile UX. Soft-wrap
at character boundaries (so long paths break cleanly) keeps the entire
command visible inside the popup with NO scroll required.

Concrete change set (proposed):

1. `SidebarBashView.tsx`: remove the outer `<ScrollView horizontal>` wrapper
   and `commandWrapper.minWidth: '100%'`. Pass a new `wrap` prop to
   CommandView.
2. `CommandView.tsx`: accept a `wrap?: boolean` prop. When true, set
   `line` style to include `flexWrap: 'wrap'` AND set `commandText` to
   `flexShrink: 1` plus web-only `wordBreak: 'break-all'`. When `wrap` is
   undefined/false (BashViewFull, CodexBashView), keep the cycle-1 behavior
   (intrinsic width + outer horizontal ScrollView in caller).

This preserves cycle-1 behavior for callers that have horizontal scroll
infrastructure (BashViewFull, CodexBashView) and switches the popup-specific
renderer to wrap mode.
