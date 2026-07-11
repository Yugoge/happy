import type { Metadata } from '@/sync/storageTypes';
import { hackModes } from '@/sync/modeHacks';

export type ModeOption = {
    key: string;
    name: string;
    description?: string | null;
};

export type PermissionMode = ModeOption;
export type ModelMode = ModeOption;

export type EffortLevel = ModeOption;
export type PermissionModeKey = string;
export type ModelModeKey = string;

export type AgentFlavor = 'claude' | 'codex' | 'gemini' | string | null | undefined;

type Translate = (key: any) => string;

type MetadataOption = {
    code: string;
    value: string;
    description?: string | null;
};

const GEMINI_MODEL_FALLBACKS: ModelMode[] = [
    { key: 'gemini-2.5-pro', name: 'gemini 2.5 pro', description: 'most capable' },
    { key: 'gemini-2.5-flash', name: 'gemini 2.5 flash', description: 'fast & efficient' },
    { key: 'gemini-2.5-flash-lite', name: 'gemini 2.5 flash lite', description: 'fastest' },
];

export function mapMetadataOptions(options?: MetadataOption[] | null): ModeOption[] {
    if (!options || options.length === 0) {
        return [];
    }

    return options.map((option) => ({
        key: option.code,
        name: option.value,
        description: option.description ?? null,
    }));
}

export function getClaudePermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.permissionMode.default'), description: null },
        { key: 'acceptEdits', name: translate('agentInput.permissionMode.acceptEdits'), description: null },
        { key: 'plan', name: translate('agentInput.permissionMode.plan'), description: null },
        { key: 'dontAsk', name: translate('agentInput.permissionMode.dontAsk'), description: null },
        { key: 'bypassPermissions', name: translate('agentInput.permissionMode.bypassPermissions'), description: null },
    ];
}

export function getCodexPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.codexPermissionMode.default'), description: null },
        // Plan mode is what enables codex's interactive request_user_input (the CLI sets
        // collaborationMode='plan' only when permissionMode==='plan'); expose it like Claude/Gemini.
        { key: 'plan', name: translate('agentInput.codexPermissionMode.plan'), description: null },
        { key: 'read-only', name: translate('agentInput.codexPermissionMode.readOnly'), description: null },
        { key: 'safe-yolo', name: translate('agentInput.codexPermissionMode.safeYolo'), description: null },
        { key: 'yolo', name: translate('agentInput.codexPermissionMode.yolo'), description: null },
    ];
}

export function getGeminiPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.geminiPermissionMode.default'), description: null },
        { key: 'auto_edit', name: translate('agentInput.geminiPermissionMode.autoEdit'), description: null },
        { key: 'yolo', name: translate('agentInput.geminiPermissionMode.yolo'), description: null },
        { key: 'plan', name: translate('agentInput.geminiPermissionMode.plan'), description: null },
    ];
}

export function getClaudeModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'default model', description: null },
        { key: 'opus', name: 'opus 4.6', description: null },
        { key: 'sonnet', name: 'sonnet 4.6', description: null },
        { key: 'haiku', name: 'haiku 4.5', description: null },
    ];
}

// Per-model context-window ceiling (in tokens) used as the denominator
// for the status-bar "N% left" context indicator.
//
// app-side conservative fallback: default 200K; 1M when [1m] marker,
// ':1m', '-1m-', or trailing '1m' detected (case-insensitive). Note:
// Anthropic platform may auto-upgrade some plans to 1M without marker —
// this app cannot detect that without metadata.currentModelCode
// (populated by both ACP and normal Claude SDK paths post-Cycle-10 M3').
//
// Detection patterns for Anthropic 1M-context model variants (matched
// against `modelKey.toLowerCase()` so all checks are case-insensitive):
//   - /1m$/         matches trailing "-1m" / "-1M" suffix
//                   (e.g., "claude-opus-4-7-20260301-1m")
//   - '-1m-'        matches "-1m-" anywhere in the key
//   - ':1m'         matches ":1m" variant qualifier
//                   (e.g., "claude-3-7-sonnet-20250219:thinking:1m")
//   - /\[1m\]/      matches bracket-suffix variants
//                   (e.g., "opus[1m]", "sonnet[1m]", "claude-opus-4-7[1m]")
//
// Source: Anthropic Claude Code model config documentation
// (https://code.claude.com/docs/en/model-config) — Claude 3/4 standard
// models are 200K context; only opus[1m] / sonnet[1m] / *-1m* variants
// carry 1M.
export function getModelContextWindow(modelKey: string | null | undefined): number {
    if (!modelKey) return 200_000;
    const lk = modelKey.toLowerCase();
    if (/1m$/.test(lk) || lk.includes('-1m-') || lk.includes(':1m') || /\[1m\]/.test(lk)) {
        return 1_000_000;
    }
    return 200_000;
}

// Default-picker context-window resolution (Cycle 10 M1 fix).
//
// When the picker key is 'default' (or absent) AND `metadata.currentModelCode`
// is also absent, the underlying model identity is not encoded anywhere
// the app can see. The conservative fallback is 200K because Claude
// 3/4 standard models ship at 200K; only explicit 1M-marker variants
// (`opus[1m]`, `sonnet[1m]`, `*-1m`, etc.) carry 1M.
//
// Mapping (per Anthropic Claude Code public docs):
//   - claude  →   200_000  (Claude 3/4 standard)
//   - gemini  → 1_000_000  (Gemini 2.5 series is ≥ 1M)
//   - codex   →   200_000  (gpt-5 series effective context)
//   - unknown →   200_000  (conservative fallback)
//
// Source: https://code.claude.com/docs/en/model-config
export function getDefaultModelContextWindow(flavor: AgentFlavor): number {
    if (flavor === 'gemini') return 1_000_000;
    return 200_000;
}

// Cycle 10 M3: precedence-based context-window resolution helper.
//
// Behaviorally testable pure function used by AgentInput's context-remaining
// indicator. Replaces the prior inline expression so vitest can directly
// cover all four precedence cases.
//
// Precedence:
//   1. modelMode?.key set AND not 'default'  → getModelContextWindow(modelMode.key)
//   2. currentModelCode non-empty             → getModelContextWindow(currentModelCode)
//   3. otherwise                              → getDefaultModelContextWindow(flavor)
export function resolveContextWindow(
    modelMode: ModelMode | null | undefined,
    flavor: AgentFlavor,
    currentModelCode: string | null | undefined,
): number {
    const key = modelMode?.key;
    if (key && key !== 'default') {
        return getModelContextWindow(key);
    }
    if (currentModelCode && currentModelCode.length > 0) {
        return getModelContextWindow(currentModelCode);
    }
    return getDefaultModelContextWindow(flavor);
}

export function getCodexModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'default model', description: null },
        { key: 'gpt-5.4', name: 'gpt-5.4', description: null },
        { key: 'gpt-5.3-codex', name: 'gpt-5.3-codex', description: null },
        { key: 'gpt-5.2-codex', name: 'gpt-5.2-codex', description: null },
        { key: 'gpt-5.1-codex-max', name: 'gpt-5.1-codex-max', description: null },
        { key: 'gpt-5.2', name: 'gpt-5.2', description: null },
        { key: 'gpt-5.1-codex-mini', name: 'gpt-5.1-codex-mini', description: null },
    ];
}

export function getGeminiModelModes(): ModelMode[] {
    return GEMINI_MODEL_FALLBACKS;
}

export function getOpenClawPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: translate('agentInput.permissionMode.default'), description: null },
        { key: 'bypassPermissions', name: translate('agentInput.permissionMode.bypassPermissions'), description: null },
    ];
}

export function getHardcodedPermissionModes(flavor: AgentFlavor, translate: Translate): PermissionMode[] {
    if (flavor === 'codex') {
        return getCodexPermissionModes(translate);
    }
    if (flavor === 'gemini') {
        return getGeminiPermissionModes(translate);
    }
    if (flavor === 'openclaw') {
        return getOpenClawPermissionModes(translate);
    }
    return getClaudePermissionModes(translate);
}

export function getOpenClawModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'default model', description: null },
    ];
}

export function getHardcodedModelModes(flavor: AgentFlavor, _translate: Translate): ModelMode[] {
    if (flavor === 'codex') {
        return getCodexModelModes();
    }
    if (flavor === 'gemini') {
        return getGeminiModelModes();
    }
    if (flavor === 'openclaw') {
        return getOpenClawModelModes();
    }
    return getClaudeModelModes();
}

export function getAvailableModels(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
): ModelMode[] {
    const metadataModels = mapMetadataOptions(metadata?.models);
    if (metadataModels.length > 0) {
        if (flavor === 'codex' && !metadataModels.some((model) => model.key === 'default')) {
            return [{ key: 'default', name: 'default model', description: null }, ...metadataModels];
        }
        return metadataModels;
    }
    return getHardcodedModelModes(flavor, translate);
}

export function getAvailablePermissionModes(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
): PermissionMode[] {
    if (flavor === 'claude' || flavor === 'codex' || flavor === 'openclaw') {
        return hackModes(getHardcodedPermissionModes(flavor, translate));
    }

    const metadataModes = mapMetadataOptions(metadata?.operatingModes);
    if (metadataModes.length > 0) {
        return hackModes(metadataModes);
    }

    return hackModes(getHardcodedPermissionModes(flavor, translate));
}

export function findOptionByKey<T extends ModeOption>(options: T[], key: string | null | undefined): T | null {
    if (!key) {
        return null;
    }
    return options.find((option) => option.key === key) ?? null;
}

export function resolveCurrentOption<T extends ModeOption>(
    options: T[],
    preferredKeys: Array<string | null | undefined>,
): T | null {
    for (const key of preferredKeys) {
        const option = findOptionByKey(options, key);
        if (option) {
            return option;
        }
    }
    return null;
}

export function getDefaultModelKey(flavor: AgentFlavor): string {
    if (flavor === 'codex') {
        return 'default';
    }
    if (flavor === 'gemini') {
        return 'gemini-2.5-pro';
    }
    return 'default';
}

export function getDefaultPermissionModeKey(_flavor: AgentFlavor): string {
    return 'default';
}

// Effort levels per agent type

export function getClaudeEffortLevels(): EffortLevel[] {
    return [
        { key: 'low', name: 'low' },
        { key: 'medium', name: 'medium' },
        { key: 'high', name: 'high' },
    ];
}

export function getCodexEffortLevels(): EffortLevel[] {
    return [
        { key: 'low', name: 'low' },
        { key: 'medium', name: 'medium' },
        { key: 'high', name: 'high' },
        { key: 'xhigh', name: 'xhigh' },
    ];
}

export function getHardcodedEffortLevels(flavor: AgentFlavor): EffortLevel[] {
    if (flavor === 'claude') return getClaudeEffortLevels();
    if (flavor === 'codex') return getCodexEffortLevels();
    return [];
}

export function getDefaultEffortKey(flavor: AgentFlavor): string | null {
    if (flavor === 'claude' || flavor === 'codex') return 'high';
    return null;
}

// Per-model effort: returns effort levels for a specific model, or empty if the model has no effort
export function getEffortLevelsForModel(flavor: AgentFlavor, modelKey: string): EffortLevel[] {
    if (flavor === 'claude') {
        if (modelKey === 'default') return [];
        return getClaudeEffortLevels();
    }
    if (flavor === 'codex') {
        return getCodexEffortLevels();
    }
    return [];
}

// Default effort for a model — highest the model allows
export function getDefaultEffortKeyForModel(flavor: AgentFlavor, modelKey: string): string | null {
    const levels = getEffortLevelsForModel(flavor, modelKey);
    if (levels.length === 0) return null;
    return levels[levels.length - 1].key;
}

export function getSupportsWorktree(flavor: AgentFlavor): boolean {
    if (flavor === 'openclaw') return false;
    return true;
}
