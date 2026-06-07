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
}

/**
 * SINGLE shared chat-content width formula consumed (via useChatContentWidth) by
 * the chat header, message column and composer.
 *
 * Formula: max(0, windowWidth - leftDrawerWidth - rightSidebarWidth), where:
 *   leftDrawerWidth   = min(max(floor(W*0.3),250),360) when the permanent
 *                       drawer is visible (authenticated && tablet && !collapsed),
 *                       else 0 — mirrors SidebarNavigator's drawer formula.
 *   rightSidebarWidth = 450 ONLY when the sidebar is open AND windowWidth>=901
 *                       (real desktop side panel); 0 on mobile (full-screen
 *                       modal that does not occupy the row).
 * NO web/tablet 800 cap is applied on ANY platform — the adaptive formula's
 * true output drives the layout.
 */
export function computeChatContentWidth(inputs: ChatContentWidthInputs): number {
    const { windowWidth, isAuthenticated, isTablet, sidebarCollapsed, rightSidebarOpen } = inputs;
    // SSR / first-paint guard (pre-existing, removal_authorized:false): before
    // useWindowDimensions measures, windowWidth is 0; fall back to a non-zero
    // width so the chat surfaces never collapse to maxWidth:0. This is the only
    // case the fallback fires — it is NOT the removed web/tablet 800 cap.
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
    return Math.max(0, windowWidth - leftDrawerWidth - rightSidebarWidth);
}
