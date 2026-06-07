import { useChatContentWidth } from '@/hooks/useChatContentWidth';

/**
 * Effective max-width for the MessageView message column.
 *
 * As of spec-20260607-124814.md Item 7 this delegates to the SINGLE shared
 * chat-content width source (useChatContentWidth) so the message column, chat
 * header and composer all derive width from ONE formula. The previous, separate
 * computation carried a web/tablet `Math.min(available, 800)` cap that diverged
 * from the (uncapped) header hook -- the very divergence the user reported. That
 * capped path is removed entirely here so it can never resurface; the shared
 * source applies NO 800 cap on any platform, and subtracts the right sidebar
 * (450) only when it is a real desktop side panel (open && windowWidth>=901).
 *
 * MessageView now consumes useChatContentWidth directly; this thin re-export is
 * kept as a stable alias for the message-column width.
 */
export function useMessageContentMaxWidth(): number {
    return useChatContentWidth();
}
