import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { useIsTablet } from '@/utils/responsive';
import { useLocalSetting } from '@/sync/storage';
import { useRightSidebar } from '@/stores/rightSidebarStore';

// Mirrors RightSidebar.tsx constants; duplicated here to avoid a circular
// import since RightSidebar consumes other hooks. Keep in sync if they change.
const RIGHT_SIDEBAR_WIDTH = 450;
const RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH = 901;

interface HeaderMaxWidthInputs {
    windowWidth: number;
    isAuthenticated: boolean;
    isTablet: boolean;
    sidebarCollapsed: boolean;
    rightSidebarOpen: boolean;
}

// Pure computation extracted from the hook to keep the hook body small and
// testable. Do not call React hooks here.
function computeHeaderMaxWidth(inputs: HeaderMaxWidthInputs): number {
    const { windowWidth, isAuthenticated, isTablet, sidebarCollapsed, rightSidebarOpen } = inputs;
    const showPermanentDrawer = isAuthenticated && isTablet;
    const drawerVisible = showPermanentDrawer && !sidebarCollapsed;
    const leftDrawerWidth = drawerVisible
        ? Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360)
        : 0;
    const isRightSidebarDesktop = windowWidth >= RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH;
    const rightSidebarWidth = rightSidebarOpen && isRightSidebarDesktop
        ? RIGHT_SIDEBAR_WIDTH
        : 0;
    // Cycle 6 (BA spec dev-20260425-201355-5-4-5): removed
    // WEB_TABLET_MAX_WIDTH_CAP=800. Cycle 1 carried that value over from the
    // legacy static `layout.headerMaxWidth`; user feedback in
    // spec-20260424-084848.md §7 (line 2883–2887) directs to remove the cap so
    // the header content row fills the available main area on all platforms.
    return Math.max(0, windowWidth - leftDrawerWidth - rightSidebarWidth);
}

/**
 * Computes the effective max-width for the top-bar "content" row.
 *
 * Replaces the old static `layout.headerMaxWidth` constant (evaluated once at
 * module load) with a hook that re-evaluates on every render, so the header
 * reflows when the window resizes or when either sidebar opens/closes.
 *
 * Formula: windowWidth - leftDrawerWidth - rightSidebarWidth, where:
 *   leftDrawerWidth   = 0 when the permanent drawer is hidden or collapsed;
 *                       otherwise mirrors SidebarNavigator's drawer formula.
 *   rightSidebarWidth = 450 only when viewport >= 901px AND sidebar open;
 *                       0 on mobile (sidebar is full-screen modal there).
 * No upper cap is applied on any platform — the formula's true output drives
 * layout. See compute function comment for rationale (Cycle 6 BA spec
 * dev-20260425-201355-5-4-5).
 */
export function useHeaderMaxWidth(): number {
    const auth = useAuth();
    const isTablet = useIsTablet();
    // 'sidebarCollapsed' is stored via LocalSettings passthrough (not in the
    // explicit zod schema). SidebarNavigator.tsx:15 reads the same key via the
    // mutable variant with a pre-existing TS error — we accept the same here.
    const sidebarCollapsed = useLocalSetting('sidebarCollapsed' as any);
    const { width: windowWidth } = useWindowDimensions();
    const rightSidebarOpen = useRightSidebar((s) => s.isOpen);
    return React.useMemo(() => computeHeaderMaxWidth({
        windowWidth,
        isAuthenticated: auth.isAuthenticated,
        isTablet,
        sidebarCollapsed: !!sidebarCollapsed,
        rightSidebarOpen,
    }), [auth.isAuthenticated, isTablet, sidebarCollapsed, windowWidth, rightSidebarOpen]);
}
