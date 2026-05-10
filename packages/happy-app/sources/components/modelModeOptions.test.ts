import { describe, expect, it } from 'vitest';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getCodexModelModes,
    getClaudePermissionModes,
    getDefaultModelContextWindow,
    getModelContextWindow,
    mapMetadataOptions,
    resolveContextWindow,
    resolveCurrentOption,
} from './modelModeOptions';

const translate = (key: string) => `tr:${key}`;

describe('modelModeOptions', () => {
    it('maps metadata option shape into mode options', () => {
        expect(mapMetadataOptions([
            { code: 'm1', value: 'Model One', description: 'Primary model' },
            { code: 'm2', value: 'Model Two' },
        ])).toEqual([
            { key: 'm1', name: 'Model One', description: 'Primary model' },
            { key: 'm2', name: 'Model Two', description: null },
        ]);
    });

    it('builds claude permission fallbacks with translated names', () => {
        const modes = getClaudePermissionModes(translate);
        expect(modes.map((mode) => mode.key)).toEqual(['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']);
        expect(modes[0].name).toBe('tr:agentInput.permissionMode.default');
    });

    it('builds codex model fallbacks', () => {
        const models = getCodexModelModes();
        expect(models.map((model) => model.key)).toEqual([
            'default',
            'gpt-5.4',
            'gpt-5.3-codex',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.2',
            'gpt-5.1-codex-mini',
        ]);
        expect(models[0].name).toBe('default model');
        expect(models[1].name).toBe('gpt-5.4');
    });

    it('prefers metadata models over hardcoded fallbacks', () => {
        const models = getAvailableModels('gemini', {
            models: [
                { code: 'custom-gemini', value: 'Gemini Custom', description: 'From metadata' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'custom-gemini', name: 'Gemini Custom', description: 'From metadata' },
        ]);
    });

    it('adds codex default model option when metadata models are present', () => {
        const models = getAvailableModels('codex', {
            models: [
                { code: 'gpt-5.4', value: 'gpt-5.4', description: 'Latest' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'default', name: 'default model', description: null },
            { key: 'gpt-5.4', name: 'gpt-5.4', description: 'Latest' },
        ]);
    });

    it('keeps codex permission modes hardcoded even when metadata modes exist', () => {
        const modes = getAvailablePermissionModes('codex', {
            operatingModes: [{ code: 'metadata-only', value: 'Metadata Mode', description: null }],
        } as any, translate);

        expect(modes.map((mode) => mode.key)).toEqual(['default', 'read-only', 'safe-yolo', 'yolo']);
    });

    it('applies hacks to metadata-provided operating modes', () => {
        const modes = getAvailablePermissionModes('gemini', {
            operatingModes: [
                { code: 'build', value: 'build, build', description: 'Do build steps' },
                { code: 'plan', value: 'plan/plan', description: 'Plan first' },
            ],
        } as any, translate);

        expect(modes).toEqual([
            { key: 'build', name: 'Build', description: 'Do build steps' },
            { key: 'plan', name: 'Plan', description: 'Plan first' },
        ]);
    });

    it('resolves the first matching preferred key', () => {
        const options = [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
        ];

        expect(resolveCurrentOption(options, ['missing', 'b', 'a'])).toEqual({ key: 'b', name: 'B' });
        expect(resolveCurrentOption(options, ['missing'])).toBeNull();
    });

    // Cycle 10 M4: getDefaultModelContextWindow flavor mapping
    describe('getDefaultModelContextWindow (Cycle 10 M1)', () => {
        it('returns 200_000 for claude (was 1_000_000 pre-Cycle-10)', () => {
            expect(getDefaultModelContextWindow('claude')).toBe(200_000);
        });

        it('returns 200_000 for codex (unchanged)', () => {
            expect(getDefaultModelContextWindow('codex')).toBe(200_000);
        });

        it('returns 1_000_000 for gemini (unchanged — Gemini 2.5 spec)', () => {
            expect(getDefaultModelContextWindow('gemini')).toBe(1_000_000);
        });

        it('returns 200_000 for unknown/null/undefined flavor (conservative fallback)', () => {
            expect(getDefaultModelContextWindow(undefined)).toBe(200_000);
            expect(getDefaultModelContextWindow(null)).toBe(200_000);
            expect(getDefaultModelContextWindow('openclaw')).toBe(200_000);
        });
    });

    // Cycle 10 M4: getModelContextWindow 1M-marker detection (incl. F4 case-insensitivity)
    describe('getModelContextWindow (Cycle 10 M2)', () => {
        it('returns 1_000_000 for bracket-suffix [1m] variants', () => {
            expect(getModelContextWindow('opus[1m]')).toBe(1_000_000);
            expect(getModelContextWindow('sonnet[1m]')).toBe(1_000_000);
            expect(getModelContextWindow('claude-opus-4-7[1m]')).toBe(1_000_000);
        });

        it('returns 1_000_000 for uppercase bracket [1M] (F4 case-insensitive)', () => {
            expect(getModelContextWindow('opus[1M]')).toBe(1_000_000);
            expect(getModelContextWindow('claude-opus-4-7[1M]')).toBe(1_000_000);
        });

        it('returns 1_000_000 for uppercase trailing -1M / suffix (F4 case-insensitive)', () => {
            expect(getModelContextWindow('claude-OPUS-1M')).toBe(1_000_000);
            expect(getModelContextWindow('claude-opus-4-7-1M')).toBe(1_000_000);
        });

        it('returns 1_000_000 for uppercase :1M qualifier (F4 case-insensitive)', () => {
            expect(getModelContextWindow('claude:1M')).toBe(1_000_000);
            expect(getModelContextWindow('claude-3-7-sonnet:thinking:1M')).toBe(1_000_000);
        });

        it('returns 1_000_000 for prior matching forms (no regression)', () => {
            expect(getModelContextWindow('claude-opus-4-7-20260301-1m')).toBe(1_000_000);
            expect(getModelContextWindow('claude-opus-4-7-1m-experimental')).toBe(1_000_000);
            expect(getModelContextWindow('claude-3-7-sonnet:thinking:1m')).toBe(1_000_000);
        });

        it('returns 200_000 for non-1M Claude variants (negative case)', () => {
            expect(getModelContextWindow('claude-sonnet')).toBe(200_000);
            expect(getModelContextWindow('claude-opus-4-7')).toBe(200_000);
            expect(getModelContextWindow('claude-haiku-4-5')).toBe(200_000);
        });

        it('returns 200_000 for null/undefined/empty key', () => {
            expect(getModelContextWindow(null)).toBe(200_000);
            expect(getModelContextWindow(undefined)).toBe(200_000);
            expect(getModelContextWindow('')).toBe(200_000);
        });
    });

    // Cycle 10 M4b: resolveContextWindow precedence helper
    describe('resolveContextWindow (Cycle 10 M3 / M4b)', () => {
        it('returns 200_000 for default modelMode + no metadata (conservative fallback)', () => {
            expect(resolveContextWindow({ key: 'default', name: 'default model' }, 'claude', undefined)).toBe(200_000);
        });

        it('returns 1_000_000 for default modelMode + 1M-marker metadata (metadata-aware path)', () => {
            expect(resolveContextWindow({ key: 'default', name: 'default model' }, 'claude', 'claude-sonnet-4.5-1m')).toBe(1_000_000);
        });

        it('returns 200_000 for default modelMode + non-1M metadata', () => {
            expect(resolveContextWindow({ key: 'default', name: 'default model' }, 'claude', 'claude-sonnet')).toBe(200_000);
        });

        it('explicit non-default modelMode wins over currentModelCode (precedence step 1)', () => {
            expect(resolveContextWindow({ key: 'opus[1m]', name: 'opus 1M' }, 'claude', 'claude-sonnet')).toBe(1_000_000);
            expect(resolveContextWindow({ key: 'sonnet', name: 'sonnet 4.6' }, 'claude', 'claude-opus-4-7-1m')).toBe(200_000);
        });

        it('returns 200_000 when modelMode is null and no metadata (fallback)', () => {
            expect(resolveContextWindow(null, 'claude', undefined)).toBe(200_000);
        });

        it('returns 1_000_000 for gemini fallback unchanged', () => {
            expect(resolveContextWindow(undefined, 'gemini', undefined)).toBe(1_000_000);
        });

        it('treats empty-string currentModelCode as missing (falls through to flavor default)', () => {
            expect(resolveContextWindow({ key: 'default', name: 'default model' }, 'claude', '')).toBe(200_000);
        });
    });
});
