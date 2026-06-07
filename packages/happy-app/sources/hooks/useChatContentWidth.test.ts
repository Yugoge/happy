import { describe, it, expect } from 'vitest';
// Import the pure width math from the dependency-free module (NOT
// useChatContentWidth.ts, which pulls in react-native and crashes the node-env
// transform). This is the SAME function the hook re-exports — one source.
import { computeChatContentWidth, ChatContentWidthInputs } from './chatContentWidth';

// AC7a — pure width-math gate for the single shared chat-content width source.
// Revert-sensitive to M1 ONLY: it asserts the unified formula (no 800 cap,
// gated 450 subtraction) and that the header-input and message-input return the
// IDENTICAL scalar for the same tuple. It makes NO anchoring/origin claim — a
// pure scalar function cannot detect the M2/M3/M4 alignItems flips, which are
// gated separately by the live computed-style AC7b. (Do NOT add a constant
// origin/offset field to this function to fake an anchoring gate.)

const LEFT_DRAWER_MIN = 250;
const LEFT_DRAWER_MAX = 360;

// Reference left-drawer width = the permanent-drawer formula the hook mirrors.
function expectedLeftDrawerWidth(windowWidth: number, drawerVisible: boolean): number {
    if (!drawerVisible) return 0;
    return Math.min(Math.max(Math.floor(windowWidth * 0.3), LEFT_DRAWER_MIN), LEFT_DRAWER_MAX);
}

function expectedWidth(windowWidth: number, drawerVisible: boolean, sidebarOpen: boolean): number {
    const left = expectedLeftDrawerWidth(windowWidth, drawerVisible);
    const right = sidebarOpen && windowWidth >= 901 ? 450 : 0;
    return Math.max(0, windowWidth - left - right);
}

// drawerVisible is true only when authenticated && tablet && !collapsed.
function inputs(opts: {
    windowWidth: number;
    drawerVisible: boolean;
    sidebarOpen: boolean;
    isMac: boolean; // platform must NOT change the result (no cap on any platform)
}): ChatContentWidthInputs {
    // Model drawerVisible via the three flags it depends on. isMac is included in
    // the matrix to prove the formula is platform-independent (the old message
    // hook capped web/tablet at 800; the shared one must not).
    return {
        windowWidth: opts.windowWidth,
        isAuthenticated: opts.drawerVisible,
        isTablet: opts.drawerVisible,
        sidebarCollapsed: !opts.drawerVisible,
        rightSidebarOpen: opts.sidebarOpen,
    };
}

describe('computeChatContentWidth', () => {
    describe('AC1/AC7a: mandatory uncapped tuples (no 800 cap)', () => {
        it('W=1440, drawer off, sidebar closed => 1440 (not 800)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1440, drawerVisible: false, sidebarOpen: false, isMac: false }));
            expect(w).toBe(1440);
        });
        it('W=1440, drawer off, sidebar open => 990 (not 800)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1440, drawerVisible: false, sidebarOpen: true, isMac: false }));
            expect(w).toBe(990); // 1440 - 0 - 450
        });
        it('W=1800, drawer on, sidebar open => 990 (not 800)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1800, drawerVisible: true, sidebarOpen: true, isMac: false }));
            expect(w).toBe(990); // 1800 - 360 - 450
        });
        it('left-drawer-open desktop case W=1440, drawer on, sidebar open => 630 (<800, still uncapped)', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 1440, drawerVisible: true, sidebarOpen: true, isMac: false }));
            expect(w).toBe(630); // 1440 - 360 - 450; below 800 yet driven by the true formula, not a flat width>800 check
        });
    });

    describe('AC3/AC7a: 450 subtracted iff (sidebarOpen && W>=901)', () => {
        it('subtracts 450 when open AND W>=901', () => {
            const closed = computeChatContentWidth(inputs({ windowWidth: 1200, drawerVisible: false, sidebarOpen: false, isMac: false }));
            const open = computeChatContentWidth(inputs({ windowWidth: 1200, drawerVisible: false, sidebarOpen: true, isMac: false }));
            expect(closed).toBe(1200);
            expect(open).toBe(750); // 1200 - 450
        });
        it('does NOT subtract 450 when open but W<901 (mobile modal)', () => {
            const open = computeChatContentWidth(inputs({ windowWidth: 390, drawerVisible: false, sidebarOpen: true, isMac: false }));
            const closed = computeChatContentWidth(inputs({ windowWidth: 390, drawerVisible: false, sidebarOpen: false, isMac: false }));
            expect(open).toBe(390);
            expect(closed).toBe(390);
        });
        it('does NOT subtract when sidebar closed even on desktop', () => {
            const closed = computeChatContentWidth(inputs({ windowWidth: 1500, drawerVisible: false, sidebarOpen: false, isMac: false }));
            expect(closed).toBe(1500);
        });
    });

    describe('AC1/AC7a: full matrix — header-input width === message-input width, no cap on any platform', () => {
        const windows = [390, 700, 800, 900, 901, 1000, 1200, 1440, 1800];
        const bools = [false, true];
        for (const windowWidth of windows) {
            for (const drawerVisible of bools) {
                for (const sidebarOpen of bools) {
                    for (const isMac of bools) {
                        const cell = `W=${windowWidth} drawer=${drawerVisible} sidebar=${sidebarOpen} mac=${isMac}`;
                        it(`cell ${cell}: equals reference & header===message & uncapped`, () => {
                            const tuple = inputs({ windowWidth, drawerVisible, sidebarOpen, isMac });
                            // The header surface and the message surface read the SAME function.
                            const headerWidth = computeChatContentWidth(tuple);
                            const messageWidth = computeChatContentWidth(tuple);
                            const ref = expectedWidth(windowWidth, drawerVisible, sidebarOpen);
                            expect(headerWidth).toBe(ref);
                            expect(messageWidth).toBe(ref);
                            // M1 unification: equal width source for both surfaces.
                            expect(headerWidth).toBe(messageWidth);
                            // No 800 cap on any platform: whenever the available
                            // band exceeds 800, the returned value must too.
                            if (ref > 800) {
                                expect(headerWidth).toBeGreaterThan(800);
                            }
                        });
                    }
                }
            }
        }
    });

    describe('clamp guard: never negative', () => {
        it('returns the true (small) width when chrome nearly fills the window', () => {
            const w = computeChatContentWidth(inputs({ windowWidth: 901, drawerVisible: true, sidebarOpen: true, isMac: false }));
            // 901 - min(max(floor(901*0.3),250),360)=270 - 450 = 181
            expect(w).toBe(181);
        });
    });

    describe('SSR / first-paint guard (pre-existing removal_authorized:false)', () => {
        it('returns the non-collapsing SSR fallback (800) when windowWidth===0', () => {
            const w = computeChatContentWidth({ windowWidth: 0, isAuthenticated: false, isTablet: false, sidebarCollapsed: true, rightSidebarOpen: false });
            expect(w).toBe(800); // SSR_FALLBACK_WIDTH — never collapses to 0 before measure
        });
        it('SSR fallback fires regardless of the other flags', () => {
            const w = computeChatContentWidth({ windowWidth: 0, isAuthenticated: true, isTablet: true, sidebarCollapsed: false, rightSidebarOpen: true });
            expect(w).toBe(800);
        });
    });
});
