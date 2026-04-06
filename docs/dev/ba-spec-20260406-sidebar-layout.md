# BA Specification: Right Sidebar Infrastructure (3-Panel Layout)

**Request ID**: dev-20260406-sidebar-layout
**Created**: 2026-04-06T09:00:00Z

## Goal

Add a right sidebar panel to the app, creating a 3-panel layout (left sidebar | main chat | right sidebar) that displays tool detail content. On desktop, it opens when clicking a tool's content area and can be collapsed. On mobile, it opens as a full-screen overlay with a back button.

## Context

The app currently uses a 2-panel layout managed by `SidebarNavigator.tsx` which wraps an `expo-router/drawer` with `drawerType: 'permanent'` on tablet/desktop. The left sidebar (`SidebarView.tsx`) contains the session list. The main content area renders `SessionView` via expo-router Stack navigation. Tool detail content is currently shown by navigating to a separate screen (`/session/[id]/message/[messageId]`), which replaces the entire main content with `ToolFullView`.

**Key architectural findings:**
- Left sidebar uses `expo-router/drawer` with `drawerType: 'permanent'` for desktop, hidden on mobile
- Collapse state is stored in `useLocalSettingMutable('sidebarCollapsed')` -- a Zustand-backed local setting (note: `sidebarCollapsed` is NOT in `LocalSettingsSchema` but works via passthrough parsing)
- Responsive detection: `useIsTablet()` hook (based on screen diagonal inches)
- Keyboard shortcut: Cmd/Ctrl+B toggles left sidebar
- Root layout: `_layout.tsx` wraps everything in `<SidebarNavigator />`, which is the single entry point for the 2-panel layout
- Tool detail navigation: clicking a tool header in the chat list navigates to `/session/[id]/message/[messageId]` via `router.push()`, which pushes a new Stack screen

## Requirements (MoSCoW)

### Must Have
- Right sidebar panel component that renders alongside the main chat area on desktop
- State management for right sidebar: open/closed state, selected tool data (sessionId + messageId)
- Desktop: right sidebar opens when user clicks a tool's CONTENT area (not the title/header)
- Desktop: right sidebar can be collapsed/hidden; default state is collapsed
- Desktop: right sidebar width ~400-500px or ~40% of remaining space
- Mobile: tool content opens as full-screen overlay (existing Stack navigation to `/session/[id]/message/[messageId]` already works this way)
- Layout modification: `SidebarNavigator.tsx` must accommodate a 3rd panel on desktop
- Right sidebar displays the same content as `ToolFullView` (reuse existing component)

### Should Have
- Keyboard shortcut to close right sidebar (e.g., Escape)
- Smooth open/close animation (matching left sidebar behavior)
- Resize handle on left edge of right sidebar (matching right edge of left sidebar)
- Persist right sidebar collapsed state in local settings

### Could Have
- Drag-to-resize right sidebar width
- Keyboard shortcut to toggle right sidebar (e.g., Cmd+])
- Right sidebar shows breadcrumb/back navigation for nested tool views

### Won't Have (Non-Goals)
- Right sidebar on mobile (mobile uses full-screen overlay via existing Stack navigation)
- Modifying the left sidebar behavior
- Changing the existing tool detail page (`/session/[id]/message/[messageId]`)
- Right sidebar for non-tool content (text messages, etc.)

## Edge Cases & Risks

- **Narrow desktop windows**: When window is too narrow to fit 3 panels, right sidebar should overlay or auto-close. Threshold: if remaining main content width < 400px, right sidebar should overlay instead of inline.
- **Session switching**: When user navigates to a different session while right sidebar is open, the sidebar should close (tool data is session-specific).
- **Tool data lifecycle**: If the tool being displayed in the sidebar updates (e.g., tool completes), sidebar content should reactively update.
- **Left sidebar + right sidebar both open**: Main content area must remain usable (minimum width).
- **Drawer component limitation**: `expo-router/drawer` only supports one drawer. The right sidebar cannot be a second Drawer. It must be a custom panel rendered alongside the Drawer.

## Acceptance Criteria

### AC1: Desktop right sidebar opens on tool content click
- GIVEN a desktop viewport (isTablet=true) with a session containing tool calls
- WHEN user clicks on a tool's content area (not the header/title bar)
- THEN the right sidebar panel opens showing the full tool detail view (ToolFullView)

### AC2: Desktop right sidebar can be closed
- GIVEN the right sidebar is open on desktop
- WHEN user clicks a close button or presses Escape
- THEN the right sidebar closes and the main chat area expands to fill the space

### AC3: Right sidebar default state
- GIVEN a fresh page load on desktop
- WHEN the app renders
- THEN the right sidebar is collapsed/hidden by default

### AC4: Mobile behavior unchanged
- GIVEN a mobile viewport (isTablet=false)
- WHEN user clicks a tool
- THEN the existing full-screen navigation to `/session/[id]/message/[messageId]` occurs (no sidebar)

### AC5: Session switching closes sidebar
- GIVEN the right sidebar is open showing a tool from session A
- WHEN user navigates to session B via the left sidebar
- THEN the right sidebar closes

### AC6: Layout does not break with all panels open
- GIVEN both left sidebar and right sidebar are open on desktop
- WHEN the window is at least 1200px wide
- THEN all three panels are visible and the main chat area has at least 300px width

## Technical Hints

- **State location**: Create a new Zustand store or add to existing storage for right sidebar state: `{ isOpen: boolean, sessionId: string | null, messageId: string | null }`
- **Layout modification**: In `SidebarNavigator.tsx`, the current structure is `<View style={{flex:1}}><Drawer />{collapsed button}</View>`. The right sidebar should be added as a sibling to the Drawer's content, NOT as a second Drawer. Approach: wrap the main content area (Slot from Drawer) and right sidebar in a flex row.
- **Alternative approach**: Since `SidebarNavigator` renders `<Drawer />` which contains the `<Slot />`, a cleaner approach may be to add the right sidebar panel inside the session view layout or inside `SessionView.tsx` itself, rendered conditionally when `isTablet && rightSidebarOpen`.
- **Tool click handler**: `ToolView.tsx` line 35-41 has `handlePress` callback. On desktop, this should open the right sidebar instead of navigating. On mobile, keep existing `router.push()` behavior.
- **Affected files**:
  - `sources/components/SidebarNavigator.tsx` -- Add right sidebar panel to layout
  - `sources/components/tools/ToolView.tsx` -- Modify click handler for desktop
  - `sources/-session/SessionView.tsx` -- Potentially wrap with right sidebar
  - New file: `sources/stores/rightSidebarStore.ts` or `sources/hooks/useRightSidebar.ts` -- State management
  - New file: `sources/components/RightSidebar.tsx` -- Right sidebar container component
- **Related patterns**: Left sidebar collapse uses `useLocalSettingMutable('sidebarCollapsed')`, right sidebar can follow same pattern
- **Constraints**: Cannot use a second `expo-router/drawer`; must be a custom View-based panel
