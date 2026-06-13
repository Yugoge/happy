// Pure, dependency-free chat-content width math (no React, no react-native).
// Kept in its own module so the node-env Vitest test (AC7a) can import the pure
// function WITHOUT pulling in react-native / React (which crash the node-env
// transform). useChatContentWidth.ts re-exports these so there is still exactly
// ONE width source. See useChatContentWidth.ts for the coordinate-system model.

// Mirrors RightSidebar.tsx constants; duplicated to avoid a circular import
// (same pattern as the other width hooks). Keep in sync.
export const RIGHT_SIDEBAR_WIDTH = 450;
export const RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH = 901;

// SSR / first-paint fallback. NOT a layout cap: it is returned ONLY when
// useWindowDimensions has not measured yet (windowWidth === 0), preventing the
// message column / composer maxWidth from collapsing to 0 before first measure.
// Preserves the pre-existing `removal_authorized:false` SSR guard from the old
// useMessageContentMaxWidth hook. Once a real width is measured this value never
// applies, so the "no 800 cap" guarantee holds for every real layout state.
export const SSR_FALLBACK_WIDTH = 800;

export interface ChatContentWidthInputs {
    windowWidth: number;
    isAuthenticated: boolean;
    isTablet: boolean;
    sidebarCollapsed: boolean;
    rightSidebarOpen: boolean;
    // Reading-column cap (the pre-Wave-1 `layout.maxWidth`). The pure module
    // cannot import react-native to derive it (Platform/Dimensions/device-type),
    // so the React hook computes it from `@/components/layout` and passes it in.
    // Semantics mirror layout.ts EXACTLY: ~800 on web/tablet, 1400 on Mac, the
    // full screen dimension on phone (so it never actually constrains there).
    readingColumnMaxWidth: number;
}

/**
 * SINGLE shared chat-content width formula consumed (via useChatContentWidth) by
 * the chat header, message column and composer.
 *
 * Formula: min(max(0, windowWidth - leftDrawerWidth - rightSidebarWidth),
 *               readingColumnMaxWidth), where:
 *   leftDrawerWidth   = min(max(floor(W*0.3),250),360) when the permanent
 *                       drawer is visible (authenticated && tablet && !collapsed),
 *                       else 0 — mirrors SidebarNavigator's drawer formula.
 *   rightSidebarWidth = 450 ONLY when the sidebar is open AND windowWidth>=901
 *                       (real desktop side panel); 0 on mobile (full-screen
 *                       modal that does not occupy the row).
 *   readingColumnMaxWidth = the pre-Wave-1 `layout.maxWidth` reading-column cap
 *                       (~800 web/tablet, 1400 Mac, full-screen on phone).
 *
 * The reading-column cap restores the comfortable centered column (Claude.ai /
 * ChatGPT style): on a WIDE window the adaptive band exceeds the cap, so the cap
 * wins and the leftover space becomes side margin once each consumer CENTERS the
 * capped column. When the window is NARROWER than the cap (mobile / phone) the
 * adaptive band wins and the column fills naturally with no margin. The right
 * sidebar is still subtracted FIRST so opening it shrinks the available band
 * before the cap applies, never enlarging the column.
 */
export function computeChatContentWidth(inputs: ChatContentWidthInputs): number {
    const { windowWidth, isAuthenticated, isTablet, sidebarCollapsed, rightSidebarOpen, readingColumnMaxWidth } = inputs;
    // SSR / first-paint guard (pre-existing, removal_authorized:false): before
    // useWindowDimensions measures, windowWidth is 0; fall back to a non-zero
    // width so the chat surfaces never collapse to maxWidth:0. This is the only
    // case the fallback fires.
    if (windowWidth === 0) {
        return SSR_FALLBACK_WIDTH;
    }
    const showPermanentDrawer = isAuthenticated && isTablet;
    const drawerVisible = showPermanentDrawer && !sidebarCollapsed;
    const leftDrawerWidth = drawerVisible
        ? Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360)
        : 0;
    const isRightSidebarDesktop = windowWidth >= RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH;
    const rightSidebarWidth = rightSidebarOpen && isRightSidebarDesktop
        ? RIGHT_SIDEBAR_WIDTH
        : 0;
    const available = Math.max(0, windowWidth - leftDrawerWidth - rightSidebarWidth);
    // Cap the adaptive band at the reading-column max so wide windows yield a
    // comfortable centered column; narrow windows fall through uncapped.
    return Math.min(available, readingColumnMaxWidth);
}
