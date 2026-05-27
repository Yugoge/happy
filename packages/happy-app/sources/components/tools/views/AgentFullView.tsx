import * as React from 'react';
import { ToolViewProps } from './_all';
import { TaskViewFull } from './TaskViewFull';

// AgentFullView: full sidebar view for Codex subagent lifecycle (spawn_agent root card).
// Delegates entirely to TaskViewFull which renders the expandable child tool list
// following Claude Code's structured Agent sidebar layout.
export const AgentFullView = React.memo<ToolViewProps>((props) => {
    return <TaskViewFull {...props} />;
});
