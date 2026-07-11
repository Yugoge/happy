import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// AC-E1 (task 20260618-142111, cluster 4-happy-app-E) — Codex "Update plan" in_progress
// item must render #007AFF (Claude TodoView parity) in BOTH light AND dark themes.
//
// Root cause: CodexPlanView colored the in_progress icon AND text with
// theme.colors.status.connecting, which resolves to #007AFF in the light theme but
// #FFFFFF (white) in the dark theme (theme.ts), so the in_progress row was invisible
// in dark mode. Claude's TodoView hardcodes '#007AFF' for in_progress in both themes.
//
// CodexPlanView.tsx transitively imports react-native / react-native-unistyles, which
// cannot load in this node-env vitest (the documented constraint shared by the sibling
// Codex view tests — CodexPatchView.test.ts, CodexAttachmentView.test.ts,
// CodexSubagentLifecycleView.test.ts). So this is a SOURCE-DERIVED, revert-sensitive
// assertion — the project's blessed substitute for a runtime render. Live desktop+mobile
// render in light AND dark is the user's binding gate (AC-E1 playwright check).

const VIEWS_DIR = resolve(__dirname);
const planSrc = readFileSync(resolve(VIEWS_DIR, 'CodexPlanView.tsx'), 'utf8');
// Reference: Claude's TodoView, the parity target.
const todoSrc = readFileSync(resolve(VIEWS_DIR, 'TodoView.tsx'), 'utf8');

// Guarded slice so a harmless edit surfaces as an explicit "anchor moved" failure
// instead of a silently-empty slice that would pass vacuously.
function sliceBetween(src: string, startAnchor: string, endAnchor: string): string {
    const start = src.indexOf(startAnchor);
    const end = src.indexOf(endAnchor, start + startAnchor.length);
    expect(start, `start anchor not found: ${startAnchor}`).toBeGreaterThanOrEqual(0);
    expect(end, `end anchor not found: ${endAnchor}`).toBeGreaterThan(start);
    return src.slice(start, end);
}

describe('AC-E1 — Codex in_progress plan item is #007AFF in both themes', () => {
    it('the in_progress ICON color is the literal #007AFF, not theme.colors.status.connecting', () => {
        // The inline icon color ternary: completed -> success, in_progress -> #007AFF, else textSecondary.
        const iconColor = sliceBetween(planSrc, "name={iconNameForStatus", '/>');
        expect(iconColor).toMatch(/in_progress'\s*\?\s*'#007AFF'/);
        // Revert guard: the theme-coupled value (white in dark) must NOT color in_progress.
        expect(iconColor).not.toMatch(/in_progress'\s*\?\s*theme\.colors\.status\.connecting/);
    });

    it('the inProgressText STYLE color is the literal #007AFF, not theme.colors.status.connecting', () => {
        const inProgressTextStyle = sliceBetween(planSrc, 'inProgressText: {', '},');
        expect(inProgressTextStyle).toMatch(/color:\s*'#007AFF'/);
        expect(inProgressTextStyle).not.toMatch(/theme\.colors\.status\.connecting/);
    });

    it('NO in_progress affordance references the theme-coupled status.connecting token anywhere', () => {
        // theme.colors.status.connecting is the dark-mode-white token; it must be gone
        // entirely from CodexPlanView so neither theme can render in_progress as white.
        expect(planSrc).not.toMatch(/status\.connecting/);
    });

    it('completed still maps to success and pending still maps to textSecondary (no over-reach)', () => {
        // Minimum-diff guard: only the in_progress color changed. The other two states
        // keep their theme tokens for both the icon and the text styles.
        const iconColor = sliceBetween(planSrc, "name={iconNameForStatus", '/>');
        expect(iconColor).toMatch(/completed'\s*\?\s*theme\.colors\.success/);
        expect(iconColor).toMatch(/:\s*theme\.colors\.textSecondary/);

        const completedTextStyle = sliceBetween(planSrc, 'completedText: {', '},');
        expect(completedTextStyle).toMatch(/color:\s*theme\.colors\.success/);
        const pendingTextStyle = sliceBetween(planSrc, 'pendingText: {', '},');
        expect(pendingTextStyle).toMatch(/color:\s*theme\.colors\.textSecondary/);
    });

    it('matches Claude TodoView parity — TodoView also hardcodes #007AFF for in_progress', () => {
        // Sanity-anchor the parity target so a future TodoView change is noticed here too.
        const todoInProgressText = sliceBetween(todoSrc, 'inProgressText: {', '},');
        expect(todoInProgressText).toMatch(/color:\s*'#007AFF'/);
        const todoIconInProgress = sliceBetween(todoSrc, 'iconInProgress: {', '},');
        expect(todoIconInProgress).toMatch(/color:\s*'#007AFF'/);
    });
});
