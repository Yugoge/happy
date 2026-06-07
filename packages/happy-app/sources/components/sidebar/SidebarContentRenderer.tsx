import * as React from 'react';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { SidebarAgentConversation } from './SidebarAgentConversation';
import { SidebarFileView } from './SidebarFileView';
import { SidebarBashView } from './SidebarBashView';
import { SidebarGenericView } from './SidebarGenericView';
import { SidebarTodoView } from './SidebarTodoView';
import { ImageToolFullView } from '@/components/tools/views/ImageToolFullView';
import { IMAGE_DETAIL_TOOLS } from '@/components/tools/views/imageToolDetail';
import { CodexParallelView } from '@/components/tools/views/CodexParallelView';
import { CodexPlanView } from '@/components/tools/views/CodexPlanView';

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
// Wave-1 Item 1 (spec-20260607-124814): the DESKTOP detail surface (this right-sidebar
// renderer) routes the image tools to the NEW text-only ImageToolFullView — Description →
// Input Params (JSON, base64 stripped) → Output (path/dimensions/type) — instead of the
// image-rendering CodexAttachmentView. Predecessor cycles routed detail to the image
// renderer (conflating inline card with detail page); this removes any image-render path
// from desktop detail and prevents a fall-through to the raw-JSON/base64 SidebarGenericView.
// Names come from the shared IMAGE_DETAIL_TOOLS source-of-truth (mobile registry +
// ToolFullView payload-ownership gate read the same set; a parity test pins them together).
const PARALLEL_TOOLS = new Set(['multi_tool_use.parallel']);

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
        return <ImageToolFullView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (PARALLEL_TOOLS.has(tool.name)) {
        return <CodexParallelView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    return <SidebarGenericView tool={tool} />;
});
