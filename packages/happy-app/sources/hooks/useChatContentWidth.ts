import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { useAuth } from '@/auth/AuthContext';
import { useIsTablet } from '@/utils/responsive';
import { useLocalSetting } from '@/sync/storage';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { computeChatContentWidth, ChatContentWidthInputs } from '@/hooks/chatContentWidth';

// The pure width math lives in the dependency-free `chatContentWidth.ts` module
// so the node-env Vitest (AC7a) can import it without React / react-native.
// Re-exported here so consumers keep a single import surface and there is still
// exactly ONE width source.
export { computeChatContentWidth } from '@/hooks/chatContentWidth';
export type { ChatContentWidthInputs } from '@/hooks/chatContentWidth';

/**
 * SINGLE shared "chat content width" source consumed by the chat header
 * (ChatHeaderView), the message column (MessageView) and the composer
 * (AgentInput + SessionView CenteredInputWidth). Returning ONE scalar for all
 * three surfaces is what guarantees equal width; LEFT-anchoring those surfaces
 * (alignItems/justifyContent 'flex-start') is what turns equal width into
 * coincident left+right edges. See spec-20260607-124814.md §0 #7 / Item 7.
 *
 * Coordinate model (codex-verified — do NOT re-introduce a double subtraction):
 *   - The chat HEADER is rendered position:'absolute' top/left/right:0 inside
 *     the route scene (SessionView.tsx:151). That scene sits inside the left
 *     drawer's flex, so it already excludes the left drawer but NOT the right
 *     sidebar. Subtracting rightSidebarWidth gives the header its correct band.
 *   - The message column + composer live inside SessionViewLoaded's
 *     flexDirection:'row' [main flex:1][RightSidebar width:450]. Their flex
 *     parent is ALREADY reduced by the 450 panel when the sidebar is open, so
 *     this scalar is applied there as an upper-bound maxWidth cap that
 *     numerically EQUALS the parent width — NOT as parentWidth-450. Do not
 *     compute parentWidth-450 on those surfaces or you double-subtract.
 *
 * The width formula itself is documented on computeChatContentWidth in
 * chatContentWidth.ts. This React hook wrapper re-evaluates on every render so
 * the chat surfaces reflow when the window resizes or when either sidebar
 * opens/closes; the pure compute function is exported (and re-exported above) so
 * the node-env Vitest test can exercise the full width matrix without a renderer.
 */
export function useChatContentWidth(): number {
    const auth = useAuth();
    const isTablet = useIsTablet();
    // 'sidebarCollapsed' is stored via LocalSettings passthrough (not in the
    // explicit zod schema); same accommodation as useHeaderMaxWidth.ts.
    const sidebarCollapsed = useLocalSetting('sidebarCollapsed' as any);
    const { width: windowWidth } = useWindowDimensions();
    const rightSidebarOpen = useRightSidebar((s) => s.isOpen);
    return React.useMemo(() => computeChatContentWidth({
        windowWidth,
        isAuthenticated: auth.isAuthenticated,
        isTablet,
        sidebarCollapsed: !!sidebarCollapsed,
        rightSidebarOpen,
    }), [auth.isAuthenticated, isTablet, sidebarCollapsed, windowWidth, rightSidebarOpen]);
}
