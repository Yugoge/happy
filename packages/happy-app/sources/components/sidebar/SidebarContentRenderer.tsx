import * as React from 'react';
import { ToolCall, Message } from '@/sync/typesMessage';
import { Metadata } from '@/sync/storageTypes';
import { SidebarAgentConversation } from './SidebarAgentConversation';
import { SidebarFileView } from './SidebarFileView';
import { SidebarBashView } from './SidebarBashView';
import { SidebarGenericView } from './SidebarGenericView';

interface SidebarContentProps {
    tool: ToolCall;
    messages: Message[];
    metadata: Metadata | null;
    sessionId: string;
}

const AGENT_TOOLS = new Set(['Task', 'Agent']);
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'CodexPatch', 'edit']);
const BASH_TOOLS = new Set(['Bash', 'CodexBash', 'execute', 'shell']);

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
    return <SidebarGenericView tool={tool} />;
});
