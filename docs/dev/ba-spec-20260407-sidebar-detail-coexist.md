# BA Specification: Right Sidebar Must Coexist with Tool Detail Page

**Request ID**: dev-20260407-sidebar-detail-coexist
**Created**: 2026-04-07T08:00:00Z

## Goal

When the user clicks a tool title in the right sidebar (or ChatList) to navigate to the detail page (`/session/[id]/message/[messageId]`), the detail page content should appear in the MIDDLE panel area while the right sidebar remains open. Currently, the detail page replaces the entire `SessionView` (including the sidebar) because it is a separate Stack screen.

## Context

The app uses expo-router's flat Stack navigator in `app/(app)/_layout.tsx`. Both `session/[id]` and `session/[id]/message/[messageId]` are registered as sibling Stack.Screen entries. When `router.push()` navigates to the message detail route, expo-router pushes a new screen onto the Stack, completely hiding the previous `session/[id]` screen -- which is where `SessionView` and its `RightSidebar` live.

The current workaround in `ToolView.tsx` (line 39) calls `closeSidebar()` before `router.push()`, so the sidebar closes before the detail page appears. This is a band-aid, not the real fix.

### Architecture Summary

```
_layout.tsx (Stack navigator)
  -> session/[id].tsx -> SessionView -> SessionViewLoaded
       -> View (flexDirection: 'row')
            -> View (flex: 1) -- main content (ChatList + input)
            -> RightSidebar -- side panel (450px on desktop)

  -> session/[id]/message/[messageId].tsx  -- SEPARATE Stack screen
       -> ToolFullView (full detail view of a tool call)
```

The fundamental conflict: `RightSidebar` is rendered INSIDE `SessionViewLoaded`, but the detail page is a PEER Stack screen that replaces `SessionView` entirely.

## Requirements (MoSCoW)

### Must Have
- Tool detail content renders in the middle area while the right sidebar remains visible and interactive
- Back navigation works correctly to return from detail view to chat list
- The right sidebar can still be opened, closed, and navigated while in detail view
- Desktop: 3-panel layout preserved (left sidebar | detail content | right sidebar)
- Mobile: reasonable behavior (sidebar as modal still works, detail page as full screen is acceptable)

### Should Have
- Smooth visual transition between chat view and detail view within the middle panel
- Header updates to show tool name and back button when in detail mode
- No unnecessary re-renders of the sidebar when switching between chat and detail view

### Could Have
- Browser history/URL reflects detail page state for deep linking
- Keyboard shortcut (Escape) to go back from detail view to chat list

### Won't Have (Non-Goals)
- Changing left sidebar (SidebarNavigator/Drawer) behavior
- Modifying `ToolFullView` component content
- Supporting multiple detail views simultaneously (only one detail at a time)
- Mobile 3-panel layout (mobile uses modal for sidebar, this is fine)

## Solution Analysis

### Option A: Render Detail Inside SessionView (RECOMMENDED)

Add a "detail mode" state to `SessionView` that conditionally renders `ToolFullView` instead of `ChatList` in the middle panel area.

**Implementation**:
- Add `detailMessageId: string | null` state to `SessionViewLoaded` (or use a Zustand store for cross-component access)
- When tool title is clicked, set `detailMessageId` instead of calling `router.push()`
- `SessionMainContent` conditionally renders either `ChatList` or `ToolFullView` based on this state
- Add a header back button that clears `detailMessageId`
- Remove `closeSidebar()` from `ToolView.handlePress`

**Pros**: Sidebar stays visible. Simple state management. No layout restructuring needed.
**Cons**: Loses native Stack navigation (gesture back, browser history entry). Need to manually handle back button and header title.

**Feasibility**: HIGH. The existing `SessionViewLoaded` already has a flex-row layout with sidebar. Swapping the left child between `ChatList` and `ToolFullView` is straightforward.

### Option B: Move RightSidebar Outside SessionView

Render `RightSidebar` in `_layout.tsx` or `SidebarNavigator.tsx`, wrapping the entire Stack navigator.

**Implementation**:
- Move `<RightSidebar />` from `SessionViewLoaded` to the `(app)/_layout.tsx` Stack wrapper
- The Stack navigator and RightSidebar become siblings in a flex-row layout
- Stack screen changes (session -> message detail) do not affect sidebar

**Pros**: Clean architectural separation. Sidebar persists across ALL screen transitions. Browser history preserved.
**Cons**: RightSidebar needs to access tool data without being inside SessionView context (already uses Zustand store, so this is feasible). The Stack's header and content area would need to be constrained to not overlap the sidebar. `_layout.tsx` returns a bare `<Stack>` currently -- wrapping it in a flex-row requires restructuring. The sidebar visibility becomes global state (already is via Zustand).

**Feasibility**: MEDIUM. Architecturally cleaner but requires more changes. The sidebar already uses a Zustand store (`rightSidebarStore.ts`), so data access is not a problem. The main challenge is restructuring `_layout.tsx` to wrap the Stack in a flex-row container.

### Option C: Stack Presentation Mode (modal/overlay)

Make `[messageId].tsx` render as a modal or transparentModal instead of a full-screen push.

**Cons**: transparentModal shows SessionView behind it but covers the sidebar. pageSheet/formSheet has fixed dimensions that do not fit the "middle panel" concept. The detail page is not semantically a modal. This approach fundamentally does not solve the problem because even transparent modals cover the full screen width.

**Feasibility**: LOW. Does not achieve the desired 3-panel coexistence.

### Recommendation: Option A

Option A is the most feasible and least disruptive approach. It keeps changes localized to `SessionView` and related components. The loss of native Stack navigation is acceptable because:
1. The detail view is contextual to a session (not a top-level route)
2. Back navigation can be handled via state + header button
3. The sidebar interaction model already uses state (Zustand store), not navigation

Option B is architecturally superior but requires restructuring `_layout.tsx` and may introduce regressions in header rendering, safe area calculations, and the SidebarNavigator/Drawer interaction. It should be considered for a future refactor.

## Edge Cases & Risks

- **Deep linking**: Direct URL to `/session/X/message/Y` currently works via Stack navigation. With Option A, this URL would need to be intercepted and translated into SessionView state. Alternatively, keep the Stack screen as a fallback for direct URL access.
- **Browser back button**: With Option A, browser back does not automatically clear detail state. Need to listen for `popstate` events or integrate with expo-router's navigation state.
- **Sidebar navigation while in detail mode**: If user clicks a different tool in the sidebar, the sidebar content changes. If that tool's title is clicked, the detail view should update to show the new tool. This is natural with state-based rendering.
- **Mobile behavior**: On mobile (width < 901px), sidebar renders as a modal. Detail view should still work as a full-screen push (Option A state swap still works, just without sidebar visible).
- **Message not found**: The current `[messageId].tsx` handles missing messages by redirecting to the session. The inline detail view needs the same logic.
- **Re-entrance from sidebar ToolView**: `ToolView` inside `SidebarContentRenderer` also has `handlePress` with `closeSidebar()` + `router.push()`. This needs to change to set the detail state instead.

## Acceptance Criteria

### AC1: Sidebar persists when viewing tool detail
- GIVEN a session view with the right sidebar open showing tool X
- WHEN user clicks tool X's title (header area)
- THEN the middle panel shows ToolFullView for tool X AND the right sidebar remains open

### AC2: Back navigation from detail view
- GIVEN the middle panel is showing ToolFullView
- WHEN user clicks the back button in the detail view header
- THEN the middle panel returns to showing the ChatList

### AC3: Sidebar interaction during detail view
- GIVEN the middle panel is showing ToolFullView for tool X
- WHEN user clicks a different tool Y's content in the right sidebar
- THEN the sidebar navigates to show tool Y's content (sidebar push works)

### AC4: Detail view updates from sidebar
- GIVEN the middle panel is showing ToolFullView for tool X, sidebar showing tool Y
- WHEN user clicks tool Y's title in the sidebar
- THEN the middle panel switches to show ToolFullView for tool Y

### AC5: Mobile behavior preserved
- GIVEN a mobile viewport (width < 901px) with sidebar as modal
- WHEN user clicks a tool title
- THEN the behavior is reasonable (either inline detail or existing Stack push)

### AC6: closeSidebar workaround removed
- GIVEN the fix is implemented
- THEN `ToolView.tsx` no longer calls `closeSidebar()` before navigation
- AND the sidebar state is preserved across detail view transitions

## Technical Hints

- Affected files:
  - `packages/happy-app/sources/-session/SessionView.tsx` -- Add detail state, conditionally render ToolFullView vs ChatList in `SessionMainContent`
  - `packages/happy-app/sources/components/tools/ToolView.tsx` -- Remove `closeSidebar()` call, change `handlePress` to set detail state instead of `router.push()`
  - `packages/happy-app/sources/stores/rightSidebarStore.ts` -- Optionally add `detailMessageId` to sidebar store, or create a separate store
  - `packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].tsx` -- Keep as fallback for direct URL access
- The `SessionViewLoaded` component (line 264-287 of SessionView.tsx) already has the flex-row layout. The left `<View style={{ flex: 1 }}>` child is where `SessionMainContent` renders. This is the swap target.
- `ToolFullView` is already imported and used in `[messageId].tsx`. It can be reused directly in the inline detail view.
- The `rightSidebarStore` is a Zustand store accessible from anywhere. Adding a `detailMessageId` field there (or creating a separate `detailViewStore`) avoids prop drilling.
- The `ChatHeaderView` in `SessionHeader` needs to conditionally show tool name + back button when in detail mode.
