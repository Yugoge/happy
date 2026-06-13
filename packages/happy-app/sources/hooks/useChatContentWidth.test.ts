import { describe, it, expect } from 'vitest';
// Import the pure width math from the dependency-free module (NOT
// useChatContentWidth.ts, which pulls in react-native and crashes the node-env
// transform). This is the SAME function the hook re-exports — one source.
import { computeChatContentWidth, ChatContentWidthInputs } from './chatContentWidth';

// AC7a — pure width-math gate for the single shared chat-content width source.
// REVERT-SENSITIVE to the centered-reading-column restoration (Item 7): it
// asserts the unified formula CAPS the band at the reading-column max
// (layout.maxWidth, mirrored in as `readingColumnMaxWidth`) on wide windows, and
// still subtracts the right sidebar (450) BEFORE the cap. It makes NO
// anchoring/origin claim — a pure scalar function cannot detect the alignItems
// 'center' flips, which are gated separately by the live computed-style check.
//
// This file FAILS if the uncapped full-bleed behaviour is restored: every
// wide-window cell asserts the result equals the cap, NOT the full window.

// Canonical reading-column caps, mirroring layout.ts getMaxLayoutWidth():
//   web / tablet => 800, Mac => 1400, phone (non-web) => full screen dimension.
const WEB_TABLET_CAP = 800;
const MAC_CAP = 1400;
// On phone, layout.maxWidth = max(width, height) of the device — large enough
// that it never constrains the (smaller) window width. Model with a big number.
const PHONE_CAP = 100000;

const LEFT_DRAWER_MIN = 250;
const LEFT_DRAWER_MAX = 360;

// Reference left-drawer width = the permanent-drawer formula the hook mirrors.
function expectedLeftDrawerWidth(windowWidth: number, drawerVisible: boolean): number {
    if (!drawerVisible) return 0;
    return Math.min(Math.max(Math.floor(windowWidth * 0.3), LEFT_DRAWER_MIN), LEFT_DRAWER_MAX);
}

// Reference: subtract chrome FIRST (sidebar before cap), then cap at the
// reading-column max. This is the restored centered-column behaviour.
function expectedWidth(windowWidth: number, drawerVisible: boolean, sidebarOpen: boolean, cap: number): number {
    const left = expectedLeftDrawerWidth(windowWidth, drawerVisible);
    const right = sidebarOpen && windowWidth >= 901 ? 450 : 0;
    const available = Math.max(0, windowWidth - left - right);
    return Math.min(available, cap);
}

// drawerVisible is true only when authenticated && tablet && !collapsed.
function inputs(opts: {
    windowWidth: number;
    drawerVisible: boolean;
    sidebarOpen: boolean;
    cap: number;
}): ChatContentWidthInputs {
    return {
        windowWidth: opts.windowWidth,
        isAuthenticated: opts.drawerVisible,
        isTablet: opts.drawerVisible,
        sidebarCollapsed: !opts.drawerVisible,
        rightSidebarOpen: opts.sidebarOpen,
        readingColumnMaxWidth: opts.cap,
    };
}

describe('computeChatContentWidth', () => {
    describe('Item 7: reading-column cap is applied on wide windows (NOT full-bleed)', () => {
        it('W=1440, drawer off, sidebar closed, cap 800 => 800 (capped, NOT 1440)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1440, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            expect(w).toBe(800);
            // Revert guard: full-bleed would return 1440.
            expect(w).not.toBe(1440);
        });
        it('W=1920, drawer off, sidebar closed, cap 800 => 800 (capped, NOT 1920)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1920, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            expect(w).toBe(800);
            expect(w).not.toBe(1920);
        });
        it('Mac cap 1400 honored: W=1920 => 1400 (capped, NOT 1920)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1920, drawerVisible: false, sidebarOpen: false, cap: MAC_CAP }));
            expect(w).toBe(1400);
            expect(w).not.toBe(1920);
        });
    });

    describe('Item 7: narrower-than-cap windows fill naturally (mobile = full width, no margin)', () => {
        it('W=390 (mobile), cap 800 => 390 (full width, uncapped)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 390, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            expect(w).toBe(390);
        });
        it('W=700, cap 800 => 700 (below cap, fills)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 700, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            expect(w).toBe(700);
        });
        it('phone cap never constrains: W=430, cap=100000 => 430', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 430, drawerVisible: false, sidebarOpen: false, cap: PHONE_CAP }));
            expect(w).toBe(430);
        });
    });

    describe('AC3: 450 subtracted iff (sidebarOpen && W>=901), BEFORE the cap', () => {
        it('opening sidebar shrinks the band before the cap: W=1200 cap 800, closed=>800, open=>750', () => {
            const closed = computeChatContentWidth(inputs({ windowWidth: 1200, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            const open = computeChatContentWidth(inputs({ windowWidth: 1200, drawerVisible: false, sidebarOpen: true, cap: WEB_TABLET_CAP }));
            // closed: min(1200, 800) = 800 (capped).
            expect(closed).toBe(800);
            // open: min(1200-450, 800) = min(750, 800) = 750 — sidebar subtraction
            // dipped the available band BELOW the cap, so opening it genuinely
            // narrows the column. Revert guard: a post-cap subtraction would give
            // 800-450=350; an un-subtracted cap would give 800.
            expect(open).toBe(750);
            expect(open).not.toBe(800);
            expect(open).not.toBe(350);
        });
        it('opening sidebar on a very wide window stays capped if still above cap: W=2000 cap 800, open => 800', () => {
            const open = computeChatContentWidth(inputs({ windowWidth: 2000, drawerVisible: false, sidebarOpen: true, cap: WEB_TABLET_CAP }));
            // min(2000-450=1550, 800) = 800 — both stay at the cap; the sidebar
            // does NOT shrink content below the cap here, which is the desired
            // "does not shrink unexpectedly" behaviour.
            expect(open).toBe(800);
        });
        it('does NOT subtract 450 when open but W<901 (mobile modal)', () => {
            const open = computeChatContentWidth(inputs({ windowWidth: 390, drawerVisible: false, sidebarOpen: true, cap: WEB_TABLET_CAP }));
            const closed = computeChatContentWidth(inputs({ windowWidth: 390, drawerVisible: false, sidebarOpen: false, cap: WEB_TABLET_CAP }));
            expect(open).toBe(390);
            expect(closed).toBe(390);
        });
        it('does NOT subtract when sidebar closed even on desktop', () => {
            const closed = computeChatContentWidth(inputs({ windowWidth: 1500, drawerVisible: false, sidebarOpen: false, cap: MAC_CAP }));
            expect(closed).toBe(1400); // capped at Mac cap, not 1500
        });
    });

    describe('full matrix — header-input width === message-input width; capped & sidebar-aware', () => {
        const windows = [390, 700, 800, 900, 901, 1000, 1200, 1440, 1800, 2400];
        const bools = [false, true];
        const caps = [WEB_TABLET_CAP, MAC_CAP, PHONE_CAP];
        for (const windowWidth of windows) {
            for (const drawerVisible of bools) {
                for (const sidebarOpen of bools) {
                    for (const cap of caps) {
                        const label = `W=${windowWidth} drawer=${drawerVisible} sidebar=${sidebarOpen} cap=${cap}`;
                        it(`cell ${label}: equals reference & header===message & capped`, () => {
                            const tuple = inputs({ windowWidth, drawerVisible, sidebarOpen, cap });
                            // The header surface and the message surface read the SAME function.
                            const headerWidth = computeChatContentWidth(tuple);
                            const messageWidth = computeChatContentWidth(tuple);
                            const ref = expectedWidth(windowWidth, drawerVisible, sidebarOpen, cap);
                            expect(headerWidth).toBe(ref);
                            expect(messageWidth).toBe(ref);
                            // Unification: equal width source for both surfaces.
                            expect(headerWidth).toBe(messageWidth);
                            // Revert guard: the result must NEVER exceed the cap.
                            // If the cap is removed (full-bleed restored) and the
                            // available band exceeds the cap, this fails.
                            expect(headerWidth).toBeLessThanOrEqual(cap);
                        });
                    }
                }
            }
        }
    });

    describe('clamp guard: never negative', () => {
        it('returns the true (small) width when chrome nearly fills the window', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 901, drawerVisible: true, sidebarOpen: true, cap: WEB_TABLET_CAP }));
            // 901 - min(max(floor(901*0.3),250),360)=270 - 450 = 181; min(181,800)=181
            expect(w).toBe(181);
        });
    });

    describe('SSR / first-paint guard (pre-existing removal_authorized:false)', () => {
        it('returns the non-collapsing SSR fallback (800) when windowWidth===0', () => {
            const w = computeChatContentWidth({ windowWidth: 0, isAuthenticated: false, isTablet: false, sidebarCollapsed: true, rightSidebarOpen: false, readingColumnMaxWidth: WEB_TABLET_CAP });
            expect(w).toBe(800); // SSR_FALLBACK_WIDTH — never collapses to 0 before measure
        });
        it('SSR fallback fires regardless of the other flags', () => {
            const w = computeChatContentWidth({ windowWidth: 0, isAuthenticated: true, isTablet: true, sidebarCollapsed: false, rightSidebarOpen: true, readingColumnMaxWidth: MAC_CAP });
            expect(w).toBe(800);
        });
    });
});
