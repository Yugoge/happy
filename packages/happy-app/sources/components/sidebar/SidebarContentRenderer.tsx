import * as React from 'react';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { SidebarAgentConversation } from './SidebarAgentConversation';
import { SidebarFileView } from './SidebarFileView';
import { SidebarBashView } from './SidebarBashView';
import { SidebarGenericView } from './SidebarGenericView';
import { SidebarTodoView } from './SidebarTodoView';
import { CodexAttachmentView } from '@/components/tools/views/CodexAttachmentView';
import { IMAGE_DETAIL_TOOLS } from '@/components/tools/views/imageToolDetail';
import { CodexParallelView } from '@/components/tools/views/CodexParallelView';
import { CodexPlanView } from '@/components/tools/views/CodexPlanView';
import { RequestUserInputView } from '@/components/tools/views/RequestUserInputView';

interface SidebarContentProps {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

const AGENT_TOOLS = new Set(['Task', 'Agent', 'functions.spawn_agent', 'functions.subagent_lifecycle']);
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'CodexPatch', 'CodexDiff', 'edit']);
const BASH_TOOLS = new Set(['Bash', 'CodexBash', 'execute', 'shell']);
const TODO_TOOLS = new Set(['TodoWrite']);
const PLAN_TOOLS = new Set(['functions.update_plan']);
// DESKTOP right-sidebar detail for image tools MUST show the IMAGE only (no structured text).
// Per the authoritative user requirement (overrides the Wave-1 spec wording): clicking an image
// tool on desktop opens the rendered image via CodexAttachmentView, not a text-only view. Wave-1
// wrongly routed these here to the text-only ImageToolFullView — that was a misinterpretation and
// is reverted FOR THE DESKTOP SIDEBAR ONLY. The mobile full-detail page (toolFullViewRegistry in
// _all.tsx / ToolFullView.tsx) stays text-only and is intentionally left untouched. Names come
// from the shared IMAGE_DETAIL_TOOLS source-of-truth (imageToolDetail.ts) so the set remains the
// single source of truth across surfaces.
const PARALLEL_TOOLS = new Set(['multi_tool_use.parallel']);
// #5 (Cluster C / MIN-2): the desktop right-sidebar uses this SEPARATE renderer
// whose hardcoded Sets fall through to SidebarGenericView for unregistered tools.
// Route request_user_input to the specialized read-only view before that fallback
// so the desktop sidebar detail does not render the generic JSON view.
const REQUEST_USER_INPUT_TOOLS = new Set(['functions.request_user_input']);

export const SidebarContentRenderer = React.memo<SidebarContentProps>(({ tool, messages, metadata, sessionId }) => {
    if (AGENT_TOOLS.has(tool.name)) {
        return <SidebarAgentConversation tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (FILE_TOOLS.has(tool.name)) {
        return <SidebarFileView tool={tool} />;
    }
    if (BASH_TOOLS.has(tool.name)) {
        return <SidebarBashView tool={tool} />;
    }
    if (TODO_TOOLS.has(tool.name)) {
        return <SidebarTodoView tool={tool} />;
    }
    if (PLAN_TOOLS.has(tool.name)) {
        return <CodexPlanView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (IMAGE_DETAIL_TOOLS.has(tool.name)) {
        return <CodexAttachmentView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (PARALLEL_TOOLS.has(tool.name)) {
        return <CodexParallelView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (REQUEST_USER_INPUT_TOOLS.has(tool.name)) {
        return <RequestUserInputView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    return <SidebarGenericView tool={tool} />;
});
