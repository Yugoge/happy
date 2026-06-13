import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet } from 'react-native-unistyles';
import { MarkdownView } from "./markdown/MarkdownView";
import { t } from '@/text';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage, ToolCall } from "@/sync/typesMessage";
import { MessageAttachments } from "./MessageAttachments";
import { Metadata } from "@/sync/storageTypes";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import { sync } from '@/sync/sync';
import { Option } from './markdown/MarkdownView';
import { Ionicons } from '@expo/vector-icons';
import { useChatContentWidth } from '@/hooks/useChatContentWidth';
import { LifecycleSuppressionContext, isControlToolSuppressedByLifecycle } from '@/utils/codexToolRendering';


export type ToolContentPressData = {
  tool: ToolCall;
  messages: Message[];
  metadata: Metadata | null;
  sessionId: string;
};

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  onContentPress?: (data: ToolContentPressData) => void;
}) => {
  const messageContentMaxWidth = useChatContentWidth();
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true} testID="message-container">
      <View style={[styles.messageContent, { maxWidth: messageContentMaxWidth }]} testID="message-content">
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
          onContentPress={props.onContentPress}
        />
      </View>
    </View>
  );
};

interface RenderBlockProps {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  onContentPress?: (data: ToolContentPressData) => void;
}

// RenderBlock: dispatches to the correct component based on message kind
function RenderBlock(props: RenderBlockProps): React.ReactElement {
  switch (props.message.kind) {
    case 'user-text':
      return <UserTextBlock message={props.message} sessionId={props.sessionId} />;
    case 'agent-text':
      return <AgentTextBlock message={props.message} sessionId={props.sessionId} />;
    case 'tool-call':
      return <ToolCallBlock message={props.message} metadata={props.metadata}
        sessionId={props.sessionId} getMessageById={props.getMessageById}
        onContentPress={props.onContentPress} />;
    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} />;
    default:
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: {
  message: UserTextMessage;
  sessionId: string;
}) {
  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title);
  }, [props.sessionId]);

  return (
    <View style={styles.userMessageContainer}>
      <View style={styles.userMessageBubble}>
        {props.message.attachments && props.message.attachments.length > 0 && (
          <MessageAttachments attachments={props.message.attachments} />
        )}
        <MarkdownView markdown={props.message.displayText || props.message.text} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
      </View>
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
}) {
  const handleOptionPress = React.useCallback((option: Option) => {
    sync.sendMessage(props.sessionId, option.title);
  }, [props.sessionId]);

  if (props.message.isThinking) {
    return null;
  }

  return (
    <View style={styles.agentMessageContainer}>
      <MarkdownView markdown={props.message.text} onOptionPress={handleOptionPress} sessionId={props.sessionId} />
    </View>
  );
}

function LimitReachedBlock(props: { endsAt: number }) {
  const formatTime = (timestamp: number): string => {
    try {
      const date = new Date(timestamp * 1000);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return t('message.unknownTime');
    }
  };
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>
        {t('message.usageLimitUntil', { time: formatTime(props.endsAt) })}
      </Text>
    </View>
  );
}

function WrappedEventBlock(props: { label: string; content: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasContent = props.content.length > 0;
  return (
    <View style={styles.wrappedContainer}>
      <Pressable style={styles.wrappedHeader} onPress={() => setExpanded(!expanded)}>
        <Text style={styles.wrappedLabel} numberOfLines={1}>{props.label}</Text>
        {hasContent && (
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} style={styles.wrappedChevron} />
        )}
      </Pressable>
      {expanded && hasContent && (
        <View style={styles.wrappedContent}>
          <MarkdownView markdown={props.content} />
        </View>
      )}
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{t('message.switchedToMode', { mode: props.event.mode })}</Text>
      </View>
    );
  }
  if (props.event.type === 'message') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{props.event.message}</Text>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    return <LimitReachedBlock endsAt={props.event.endsAt} />;
  }
  if (props.event.type === 'wrapped') {
    return <WrappedEventBlock label={props.event.label} content={props.event.content} />;
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  onContentPress?: (data: ToolContentPressData) => void;
}) {
  // Cycle 6 — D.5 lifecycle merge: suppress underlying control card when a
  // synthetic functions.subagent_lifecycle envelope exists for its
  // sessionSubagent. Default-not-suppress (AC8): empty Map renders all cards.
  const suppressionMap = React.useContext(LifecycleSuppressionContext);
  if (!props.message.tool) return null;
  if (isControlToolSuppressedByLifecycle(props.message.tool, suppressionMap)) return null;
  return (
    <View style={styles.toolContainer}>
      <ToolView tool={props.message.tool} metadata={props.metadata}
        messages={props.message.children} sessionId={props.sessionId}
        messageId={props.message.id} onContentPress={props.onContentPress} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: 'row',
    // CENTER (M3): share the same centered reading column as the header +
    // composer so equal width yields a coincident centered band. The inline
    // maxWidth (useChatContentWidth) is the single shared width source and is now
    // capped at the reading-column max (layout.maxWidth), so wide windows get
    // symmetric side margin instead of the full-bleed clamp.
    justifyContent: 'center',
  },
  messageContent: {
    minWidth: 0,
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
  },
  userMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  agentMessageContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  toolContainer: {
    marginHorizontal: 8,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
  wrappedContainer: {
    marginHorizontal: 8,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.agentEventText,
    overflow: 'hidden',
  },
  wrappedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  wrappedLabel: {
    flex: 1,
    color: theme.colors.agentEventText,
    fontSize: 13,
    fontWeight: '500',
  },
  wrappedChevron: {
    color: theme.colors.agentEventText,
    marginLeft: 4,
  },
  wrappedContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
}));
