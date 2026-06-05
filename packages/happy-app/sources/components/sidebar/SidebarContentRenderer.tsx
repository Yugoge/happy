import * as React from 'react';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { SidebarAgentConversation } from './SidebarAgentConversation';
import { SidebarFileView } from './SidebarFileView';
import { SidebarBashView } from './SidebarBashView';
import { SidebarGenericView } from './SidebarGenericView';
import { SidebarTodoView } from './SidebarTodoView';
import { CodexAttachmentView } from '@/components/tools/views/CodexAttachmentView';
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
// image_gen aliases route the RightSidebar (DesktopSidebar panel + MobileSidebar modal, which
// share this gate) to CodexAttachmentView (inline image) instead of the JSON-only SidebarGenericView
// fallback. mcp__image_gen__imagegen is the real producer name (sessionProtocolMapper.ts:903-904);
// the dot-form image_gen.imagegen is the legacy/replay key — both kept symmetric (consistency option a).
const ATTACHMENT_TOOLS = new Set(['file', 'functions.view_image', 'mcp__image_gen__imagegen', 'image_gen.imagegen']);
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
    if (ATTACHMENT_TOOLS.has(tool.name)) {
        return <CodexAttachmentView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    if (PARALLEL_TOOLS.has(tool.name)) {
        return <CodexParallelView tool={tool} messages={messages} metadata={metadata} sessionId={sessionId} />;
    }
    return <SidebarGenericView tool={tool} />;
});
