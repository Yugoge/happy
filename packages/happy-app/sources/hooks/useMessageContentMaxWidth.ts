import { useChatContentWidth } from '@/hooks/useChatContentWidth';

/**
 * Effective max-width for the MessageView message column.
 *
 * As of Item 7 this delegates to the SINGLE shared chat-content width source
 * (useChatContentWidth) so the message column, chat header and composer all
 * derive width from ONE formula. That shared source applies the reading-column
 * cap (layout.maxWidth: ~800 web/tablet, 1400 Mac, full-screen on phone) so the
 * conversation renders as a comfortable centered column rather than full-bleed,
 * and subtracts the right sidebar (450) before the cap, only when it is a real
 * desktop side panel (open && windowWidth>=901).
 *
 * MessageView now consumes useChatContentWidth directly; this thin re-export is
 * kept as a stable alias for the message-column width.
 */
export function useMessageContentMaxWidth(): number {
    return useChatContentWidth();
}
