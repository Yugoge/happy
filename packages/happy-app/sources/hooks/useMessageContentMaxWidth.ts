import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { useIsTablet } from '@/utils/responsive';
import { useLocalSetting } from '@/sync/storage';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { isRunningOnMac } from '@/utils/platform';

// Mirrors RightSidebar.tsx constants; duplicated here to avoid a circular
// import since RightSidebar consumes other hooks. Keep in sync with the
// equivalents in useHeaderMaxWidth.ts.
const RIGHT_SIDEBAR_WIDTH = 450;
const RIGHT_SIDEBAR_DESKTOP_MIN_WIDTH = 901;

// Web/tablet cap preserved from the original static layout.maxWidth field.
const WEB_TABLET_MAX_WIDTH_CAP = 800;

interface MessageContentMaxWidthInputs {
    windowWidth: number;
    isAuthenticated: boolean;
    isTablet: boolean;
    sidebarCollapsed: boolean;
    rightSidebarOpen: boolean;
}

// Pure computation extracted from the hook to keep the hook body small and
// testable. Mirrors computeHeaderMaxWidth in useHeaderMaxWidth.ts so that the
// message-content cap reflows with exactly the same formula the header uses.
function computeMessageContentMaxWidth(inputs: MessageContentMaxWidthInputs): number {
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
    // SSR / first-paint guard: useWindowDimensions returns 0 before measure;
    // fall back to the cap so messageContent never collapses to zero width.
    if (windowWidth === 0) {
        return WEB_TABLET_MAX_WIDTH_CAP;
    }
    const available = Math.max(1, windowWidth - leftDrawerWidth - rightSidebarWidth);
    if (isRunningOnMac()) {
        return available;
    }
    return Math.min(available, WEB_TABLET_MAX_WIDTH_CAP);
}

/**
 * Computes the effective max-width for the MessageView messageContent
 * wrapper. Replaces the static `layout.maxWidth` (evaluated once at module
 * load) so the cap reflows when the window resizes or when either sidebar
 * opens/closes -- mirroring the header behaviour produced by useHeaderMaxWidth.
 *
 * Formula: windowWidth - leftDrawerWidth - rightSidebarWidth, where:
 *   leftDrawerWidth   = 0 when the permanent drawer is hidden or collapsed;
 *                       otherwise mirrors SidebarNavigator's drawer formula.
 *   rightSidebarWidth = 450 only when viewport >= 901px AND sidebar open;
 *                       0 on mobile (sidebar is full-screen modal there).
 * On Mac we return `available` (uncapped) so wide desktop windows are not
 * artificially clipped. Web/tablet cap stays at 800 to match the prior
 * static field.
 */
export function useMessageContentMaxWidth(): number {
    const auth = useAuth();
    const isTablet = useIsTablet();
    // 'sidebarCollapsed' is stored via LocalSettings passthrough (not in the
    // explicit zod schema); same accommodation as useHeaderMaxWidth.
    const sidebarCollapsed = useLocalSetting('sidebarCollapsed' as any);
    const { width: windowWidth } = useWindowDimensions();
    const rightSidebarOpen = useRightSidebar((s) => s.isOpen);
    return React.useMemo(() => computeMessageContentMaxWidth({
        windowWidth,
        isAuthenticated: auth.isAuthenticated,
        isTablet,
        sidebarCollapsed: !!sidebarCollapsed,
        rightSidebarOpen,
    }), [auth.isAuthenticated, isTablet, sidebarCollapsed, windowWidth, rightSidebarOpen]);
}
