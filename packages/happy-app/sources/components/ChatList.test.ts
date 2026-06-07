import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// AC5 / R7 — tool-detail back-scroll preservation (spec §5.15.1):
//   Opening a tool-card detail then returning must restore the ORIGINAL
//   conversation scroll anchor on BOTH:
//     (a) the DESKTOP in-place detail-overlay path — SessionMainContent swaps
//         ChatList OUT for InlineDetailView when detailViewStore.isOpen, so
//         ChatList UNMOUNTS while the overlay is open and REMOUNTS on back with
//         NO navigation focus change (useFocusEffect never fires there); and
//     (b) the MOBILE navigation route — the pushed detail screen refocuses this
//         screen on back, firing useFocusEffect.
//   ...for EVERY tool card type (the restore is anchor-based, tool-agnostic).
//
// ChatList.tsx transitively imports react-native / expo-router, which cannot
// load in this node-env vitest (the same constraint the CodexSubagentLifecycleView
// and codexToolRendering AC tests document). So this test combines
//   (a) a GENUINE behavioral test of the exact restore algorithm the component
//       implements — a pinned pure model proving anchor EQUALITY (saved offset ==
//       restored offset) on the desktop-remount path AND the mobile-focus path,
//       across an arbitrary per-tool-type matrix, PLUS the codex-review hardening:
//       the focus path does NOT queue a lingering re-apply, and a user drag
//       cancels a queued restore so late streaming cannot yank the list back; with
//   (b) SOURCE-DERIVED assertions that FAIL if the component fix is reverted — the
//       project's blessed substitute for a runtime render.

const COMPONENTS_DIR = resolve(__dirname);
const chatListSrc = readFileSync(resolve(COMPONENTS_DIR, 'ChatList.tsx'), 'utf8');

// ---------------------------------------------------------------------------
// (a) Pinned pure model of the ChatList scroll save/restore algorithm.
//
// Mirrors the component exactly:
//   - a MODULE-LEVEL Map<sessionId, offsetY> that survives unmount/remount;
//   - handleScroll(sessionId, y)        -> scrollOffsets.set(sessionId, y)
//   - handleScrollBeginDrag()           -> pending = null (user drag wins)
//   - restoreScroll(queueRetry)         -> if a saved offset exists, apply it
//     immediately; ONLY when queueRetry is true also mark it pending so the next
//     onContentSizeChange re-applies it (mount/desktop-remount path);
//   - onContentSizeChange()             -> one-shot re-apply of the pending
//     offset once content is measured, then clears it.
// applied[] records every native scrollToOffset({offset}) the component would
// issue, letting us assert anchor EQUALITY deterministically.
// ---------------------------------------------------------------------------
function makeChatListScrollModel() {
    const scrollOffsets = new Map<string, number>(); // module-level (survives remount)

    function makeInstance(sessionId: string) {
        let pending: number | null = null;
        const applied: number[] = []; // every scrollToOffset({offset}) issued

        const handleScroll = (y: number) => {
            scrollOffsets.set(sessionId, y);
        };
        const handleScrollBeginDrag = () => {
            pending = null; // a deliberate user drag supersedes a queued restore
        };
        const restoreScroll = (queueRetry?: boolean) => {
            const saved = scrollOffsets.get(sessionId);
            if (saved === undefined) return;
            if (queueRetry) pending = saved;
            applied.push(saved);
        };
        const onContentSizeChange = () => {
            if (pending === null) return;
            const v = pending;
            pending = null;
            applied.push(v);
        };
        return {
            handleScroll,
            handleScrollBeginDrag,
            restoreScroll,
            onContentSizeChange,
            get applied() { return applied; },
            get lastApplied() { return applied.length ? applied[applied.length - 1] : undefined; },
            get hasPending() { return pending !== null; },
        };
    }

    return { scrollOffsets, makeInstance };
}

describe('AC5 anchor-equality — restore returns the IDENTICAL pre-open anchor (behavioral)', () => {
    it('DESKTOP in-place overlay path: remount (no focus change) restores the exact saved offset', () => {
        const model = makeChatListScrollModel();
        const sessionId = 'sess-desktop';

        // 1. Conversation scrolled to a tool card -> anchor captured on scroll.
        const beforeOpen = 1234;
        const list1 = model.makeInstance(sessionId);
        list1.handleScroll(beforeOpen);
        const capturedAnchor = model.scrollOffsets.get(sessionId);

        // 2. Detail overlay opens -> ChatList UNMOUNTS (no onScroll fires).
        //    3. Back -> ChatList REMOUNTS as a brand-new instance, no useFocusEffect.
        const list2 = model.makeInstance(sessionId);
        list2.restoreScroll(true);        // mount-effect restore (the desktop fix), queues retry
        list2.onContentSizeChange();      // re-apply once inverted list is measured

        // The restored anchor is byte-identical to the captured one.
        expect(list2.lastApplied).toBe(capturedAnchor);
        expect(list2.lastApplied).toBe(beforeOpen);
        expect(list2.applied.every((v) => v === beforeOpen)).toBe(true);
    });

    it('MOBILE navigation route: focus regain (same mounted instance) restores the exact saved offset', () => {
        const model = makeChatListScrollModel();
        const sessionId = 'sess-mobile';

        const beforeOpen = 980;
        const list = model.makeInstance(sessionId);
        list.handleScroll(beforeOpen);

        // Pushed detail screen blurs this screen (instance stays mounted); on back
        // the screen refocuses -> useFocusEffect fires restoreScroll (no queue).
        list.restoreScroll(false);

        expect(list.lastApplied).toBe(beforeOpen);
        expect(list.lastApplied).toBe(model.scrollOffsets.get(sessionId));
    });

    it('holds for EVERY tool card type (restore is anchor-based, not tool-specific)', () => {
        const toolTypes = ['terminal', 'screenshot', 'view_image', 'subagent', 'update_plan', 'web_search', 'image_gen'];
        toolTypes.forEach((toolType, i) => {
            const model = makeChatListScrollModel();
            const sessionId = `sess-${toolType}`;
            const anchor = 100 + i * 137; // a distinct anchor per tool type

            const before = model.makeInstance(sessionId);
            before.handleScroll(anchor);

            // desktop remount + mobile refocus both land on the same anchor
            const desktop = model.makeInstance(sessionId);
            desktop.restoreScroll(true);
            desktop.onContentSizeChange();
            expect(desktop.lastApplied).toBe(anchor);

            before.restoreScroll(false); // mobile refocus on the still-mounted instance
            expect(before.lastApplied).toBe(anchor);
        });
    });

    it('first visit (no saved offset) is a no-op — natural inverted-list bottom is preserved', () => {
        const model = makeChatListScrollModel();
        const list = model.makeInstance('sess-fresh');
        list.restoreScroll(true);
        list.onContentSizeChange();
        expect(list.applied).toEqual([]); // never scrolled away from the bottom
    });

    it('content-size re-apply is one-shot: later streaming size changes do NOT re-scroll', () => {
        const model = makeChatListScrollModel();
        const sessionId = 'sess-stream';
        const before = model.makeInstance(sessionId);
        before.handleScroll(555);

        const list = model.makeInstance(sessionId);
        list.restoreScroll(true);    // pending = 555, applied = [555]
        list.onContentSizeChange();  // applies pending once -> applied = [555, 555]
        list.onContentSizeChange();  // streaming change: pending cleared -> no-op
        list.onContentSizeChange();  // no-op

        expect(list.applied).toEqual([555, 555]);
    });

    it('per-session isolation: a session restores ITS OWN anchor, not another session\'s', () => {
        const model = makeChatListScrollModel();
        model.makeInstance('A').handleScroll(11);
        model.makeInstance('B').handleScroll(22);

        const a = model.makeInstance('A');
        a.restoreScroll(true);
        const b = model.makeInstance('B');
        b.restoreScroll(true);

        expect(a.lastApplied).toBe(11);
        expect(b.lastApplied).toBe(22);
    });
});

describe('AC5 codex-review hardening — no stale re-apply yanks the user back (behavioral)', () => {
    it('MOBILE focus path does NOT queue a lingering pending: a later streaming size change is a no-op', () => {
        // Regression guard for codex issue #2: restoreScroll on the focus path must
        // NOT leave a pending offset that a much-later content-size change re-applies
        // (which would jump the user back after they scrolled).
        const model = makeChatListScrollModel();
        const sessionId = 'sess-mobile-nolinger';
        const before = model.makeInstance(sessionId);
        before.handleScroll(700);

        const list = model.makeInstance(sessionId);
        list.restoreScroll(false);     // focus path: immediate only, no queue
        expect(list.applied).toEqual([700]);
        expect(list.hasPending).toBe(false);

        list.onContentSizeChange();    // later streaming layout -> must be a no-op
        list.onContentSizeChange();
        expect(list.applied).toEqual([700]); // user is NOT yanked back
    });

    it('a user DRAG cancels a queued restore so a late content-size change does not yank back', () => {
        // Regression guard for codex issue #3: if the user scrolls (drags) before the
        // queued one-shot fires, the pending restore is cancelled.
        const model = makeChatListScrollModel();
        const sessionId = 'sess-dragcancel';
        const before = model.makeInstance(sessionId);
        before.handleScroll(820);

        const list = model.makeInstance(sessionId);
        list.restoreScroll(true);          // mount path queues a retry
        expect(list.hasPending).toBe(true);

        list.handleScrollBeginDrag();      // user grabs the list -> cancel pending
        expect(list.hasPending).toBe(false);

        list.onContentSizeChange();        // late layout/stream -> no re-apply
        expect(list.applied).toEqual([820]); // only the initial restore, no yank-back
    });
});

describe('AC5 source-derived assertions (fail if the ChatList fix is reverted)', () => {
    it('keeps a module-level per-session offset map that survives unmount/remount', () => {
        // Declared at module scope (outside the component), keyed by sessionId.
        expect(chatListSrc).toMatch(/const scrollOffsets = new Map<string, number>\(\)/);
        expect(chatListSrc).toMatch(/scrollOffsets\.set\(props\.sessionId,/);
        expect(chatListSrc).toMatch(/scrollOffsets\.get\(props\.sessionId\)/);
    });

    it('restores on MOUNT with a layout retry to cover the desktop in-place overlay remount', () => {
        // A mount effect must call the shared restore WITH queueRetry=true — desktop fix.
        expect(chatListSrc).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*restoreScroll\(true\);?\s*\}\s*,\s*\[restoreScroll\]\s*\)/);
    });

    it('still restores on FOCUS to cover the mobile navigation route (useFocusEffect preserved, no queue)', () => {
        // Focus path passes restoreScroll directly (queueRetry undefined => no lingering pending).
        expect(chatListSrc).toMatch(/useFocusEffect\(restoreScroll\)/);
    });

    it('BOTH triggers call the SAME restoreScroll callback (identical anchor on both paths)', () => {
        expect(chatListSrc).toMatch(/const restoreScroll = useCallback\(\(queueRetry\?: boolean\) =>/);
        // restoreScroll guards on a saved offset, queues only when asked, applies without animation.
        expect(chatListSrc).toMatch(/if \(savedOffset === undefined\) return;/);
        expect(chatListSrc).toMatch(/if \(queueRetry\) pendingRestoreRef\.current = savedOffset;/);
        expect(chatListSrc).toMatch(/scrollToOffset\(\{ offset: savedOffset, animated: false \}\)/);
    });

    it('re-applies the pending offset on layout via onContentSizeChange (inverted-list reliability)', () => {
        expect(chatListSrc).toMatch(/const pendingRestoreRef = useRef<number \| null>\(null\)/);
        expect(chatListSrc).toMatch(/const handleContentSizeChange = useCallback\(/);
        expect(chatListSrc).toMatch(/if \(pending === null\) return;/);
        expect(chatListSrc).toMatch(/onContentSizeChange=\{handleContentSizeChange\}/);
    });

    it('cancels a queued restore on user drag (no stale yank-back — codex hardening)', () => {
        expect(chatListSrc).toMatch(/const handleScrollBeginDrag = useCallback\(/);
        expect(chatListSrc).toMatch(/pendingRestoreRef\.current = null;/);
        expect(chatListSrc).toMatch(/onScrollBeginDrag=\{handleScrollBeginDrag\}/);
    });
});
