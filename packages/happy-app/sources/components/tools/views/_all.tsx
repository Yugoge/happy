import * as React from 'react';
import { EditView } from './EditView';
import { BashView } from './BashView';
import { Message, ToolCall } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { WriteView } from './WriteView';
import { TodoView } from './TodoView';
import { ExitPlanToolView } from './ExitPlanToolView';
import { MultiEditView } from './MultiEditView';
import { TaskView } from './TaskView';
import { TaskViewFull } from './TaskViewFull';
import { BashViewFull } from './BashViewFull';
import { EditViewFull } from './EditViewFull';
import { MultiEditViewFull } from './MultiEditViewFull';
import { CodexBashView, CodexBashViewFull } from './CodexBashView';
import { CodexPatchView, CodexPatchViewFull } from './CodexPatchView';
import { CodexDiffView, CodexDiffViewFull } from './CodexDiffView';
import { CodexSubagentView } from './CodexSubagentView';
import { CodexSubagentLifecycleView } from './CodexSubagentLifecycleView';
import { AgentFullView } from './AgentFullView';
import { CodexParallelView } from './CodexParallelView';
import { CodexPlanView } from './CodexPlanView';
import { CodexAttachmentView } from './CodexAttachmentView';
import { ImageToolFullView } from './ImageToolFullView';
import { ReadView } from './ReadView';
import { AskUserQuestionView } from './AskUserQuestionView';
import { GeminiEditView } from './GeminiEditView';
import { GeminiExecuteView } from './GeminiExecuteView';

export type ToolViewProps = {
    tool: ToolCall;
    metadata: Metadata | null;
    messages: Message[];
    sessionId?: string;
}

// Type for tool view components
export type ToolViewComponent = React.ComponentType<ToolViewProps>;

// Registry of tool-specific view components
export const toolViewRegistry: Record<string, ToolViewComponent> = {
    Edit: EditView,
    Bash: BashView,
    CodexBash: CodexBashView,
    CodexPatch: CodexPatchView,
    CodexDiff: CodexDiffView,
    'functions.update_plan': CodexPlanView,
    'functions.view_image': CodexAttachmentView,
    file: CodexAttachmentView,
    'mcp__playwright__browser_take_screenshot': CodexAttachmentView,
    'image_gen.imagegen': CodexAttachmentView,
    // Real producer-emitted MCP name (happy-cli sessionProtocolMapper.ts:903-904
    // builds `mcp__${server}__${tool}` = mcp__image_gen__imagegen). The dot-form
    // above is the legacy/replay key; this is the name a live session actually emits.
    'mcp__image_gen__imagegen': CodexAttachmentView,
    // §5.13 AC4 — the REAL Codex-emitted image-generation name (app-server
    // imageGeneration item → mapper functions.image_generation). The mcp__/dot
    // forms above are guessed names never emitted live; this routes the real one
    // to the image renderer so the generated image renders inline.
    'functions.image_generation': CodexAttachmentView,
    // B05 (bidirectional): Claude Read of an image gains an inline preview thumbnail.
    Read: ReadView,
    Write: WriteView,
    TodoWrite: TodoView,
    ExitPlanMode: ExitPlanToolView,
    exit_plan_mode: ExitPlanToolView,
    MultiEdit: MultiEditView,
    Task: TaskView,
    Agent: TaskView,
    AskUserQuestion: AskUserQuestionView,
    // §5.15 Phase C — Codex subagent lifecycle verbs (DORMANT until protocol emits events)
    'functions.spawn_agent': CodexSubagentView,
    'functions.send_input': CodexSubagentView,
    'functions.wait_agent': CodexSubagentView,
    'functions.resume_agent': CodexSubagentView,
    'functions.close_agent': CodexSubagentView,
    // Non-prefixed lifecycle verbs — reducer synthetic grouping path (CONSTRAINT-2)
    spawn_agent: TaskView,
    send_input: CodexSubagentView,
    wait_agent: CodexSubagentView,
    close_agent: CodexSubagentView,
    // Cycle 6 — D.5 subagent lifecycle merged card (synthetic envelope).
    'functions.subagent_lifecycle': CodexSubagentLifecycleView,
    // §5.15 Phase D — Codex parallel tool dispatch (DORMANT until protocol emits events)
    'multi_tool_use.parallel': CodexParallelView,
    // Gemini tools (lowercase)
    edit: GeminiEditView,
    execute: GeminiExecuteView,
};

export const toolFullViewRegistry: Record<string, ToolViewComponent> = {
    CodexBash: CodexBashViewFull,
    CodexPatch: CodexPatchViewFull,
    CodexDiff: CodexDiffViewFull,
    'functions.update_plan': CodexPlanView,
    // Wave-1 Item 1 (spec-20260607-124814): the image-tool DETAIL page must be
    // Claude-Code-style text-only (Description → Input Params JSON → Output
    // path/dimensions/type) — NO image render, NO base64 leak. Detail routes to the
    // new ImageToolFullView, NOT the image-rendering CodexAttachmentView (which stays
    // the INLINE card via toolViewRegistry above). Names mirror IMAGE_DETAIL_TOOLS.
    'functions.view_image': ImageToolFullView,
    file: ImageToolFullView,
    'mcp__playwright__browser_take_screenshot': ImageToolFullView,
    'image_gen.imagegen': ImageToolFullView,
    'mcp__image_gen__imagegen': ImageToolFullView,
    'functions.image_generation': ImageToolFullView,
    'multi_tool_use.parallel': CodexParallelView,
    MultiEdit: MultiEditViewFull,
    // CONSTRAINT-2: reducer synthetic grouping — spawn_agent (no prefix) → AgentFullView
    spawn_agent: AgentFullView,
    // Also register functions.spawn_agent for the protocol-level verb
    'functions.spawn_agent': AgentFullView,
    // Lifecycle envelope is the primary visible card when protocol emits it —
    // must also get AgentFullView so sidebar renders TaskViewFull for it.
    'functions.subagent_lifecycle': AgentFullView,
};

// Helper function to get the appropriate view component for a tool
export function getToolViewComponent(toolName: string): ToolViewComponent | null {
    return toolViewRegistry[toolName] || null;
}

// Helper function to get the full view component for a tool
export function getToolFullViewComponent(toolName: string): ToolViewComponent | null {
    return toolFullViewRegistry[toolName] || null;
}

// Export individual components
export { EditView } from './EditView';
export { BashView } from './BashView';
export { CodexBashView } from './CodexBashView';
export { CodexPatchView, CodexPatchViewFull } from './CodexPatchView';
export { CodexDiffView, CodexDiffViewFull } from './CodexDiffView';
export { CodexSubagentView } from './CodexSubagentView';
export { CodexParallelView } from './CodexParallelView';
export { CodexPlanView } from './CodexPlanView';
export { CodexAttachmentView } from './CodexAttachmentView';
export { BashViewFull } from './BashViewFull';
export { EditViewFull } from './EditViewFull';
export { MultiEditViewFull } from './MultiEditViewFull';
export { ExitPlanToolView } from './ExitPlanToolView';
export { MultiEditView } from './MultiEditView';
export { TaskView } from './TaskView';
export { TaskViewFull } from './TaskViewFull';
export { AgentFullView } from './AgentFullView';
export { AskUserQuestionView } from './AskUserQuestionView';
export { GeminiEditView } from './GeminiEditView';
export { GeminiExecuteView } from './GeminiExecuteView';
