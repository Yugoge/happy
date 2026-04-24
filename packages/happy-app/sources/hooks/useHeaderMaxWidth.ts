import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { useIsTablet } from '@/utils/responsive';
import { useLocalSetting } from '@/sync/storage';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { isRunningOnMac } from '@/utils/platform';

// Mirrors RightSidebar.tsx constants; duplicated here to avoid a circular
// import since RightSidebar consumes other hooks. Keep in sync if they change.
const RIGHT_SIDEBAR_WIDTH = 450;
const RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH = 901;

// Web/tablet cap preserved from the original static layout.headerMaxWidth.
const WEB_TABLET_MAX_WIDTH_CAP = 800;

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
    const available = Math.max(0, windowWidth - leftDrawerWidth - rightSidebarWidth);
    if (isRunningOnMac()) {
        return available;
    }
    return Math.min(available, WEB_TABLET_MAX_WIDTH_CAP);
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
 * On Mac the original code returned Infinity; we preserve "no cap" semantics
 * by returning `available` directly. Web/tablet caps at 800 as before.
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
