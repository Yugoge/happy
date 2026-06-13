import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput } from '@/components/AgentInput';
import { useChatContentWidth } from '@/hooks/useChatContentWidth';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getDefaultModelKey,
    getDefaultPermissionModeKey,
    resolveCurrentOption,
} from '@/components/modelModeOptions';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { ChatList } from '@/components/ChatList';
import { Deferred } from '@/components/Deferred';
import { EmptyMessages } from '@/components/EmptyMessages';
import { RightSidebar } from '@/components/RightSidebar';
import { SessionActionsAnchor, SessionActionsPopover } from '@/components/SessionActionsPopover';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useAttachments } from '@/hooks/useAttachments';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { sessionAbort } from '@/sync/ops';
import { storage, useIsDataReady, useLocalSetting, useRealtimeStatus, useSessionMessages, useSessionUsage, useSetting, useSocketStatus } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { useRightSidebar } from '@/stores/rightSidebarStore';
import { useDetailView } from '@/stores/detailViewStore';
import { ToolFullView } from '@/components/tools/ToolFullView';
import { ToolHeader } from '@/components/tools/ToolHeader';
import { ToolStatusIndicator } from '@/components/tools/ToolStatusIndicator';
import { sync } from '@/sync/sync';
import { t, getCurrentLanguage } from '@/text';
import { tracking, trackMessageSent } from '@/track';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { formatPathRelativeToHome, getResumeCommandBlock, getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import type { ModelMode, PermissionMode } from '@/components/PermissionModeSelector';

export const SessionView = React.memo((props: { id: string }) => {
    return <SessionViewInner id={props.id} />;
});

function useHeaderProps(session: Session | null, isDataReady: boolean, sessionId: string) {
    const router = useRouter();
    return useMemo(() => {
        if (!isDataReady) {
            return { title: '', isConnected: false, flavor: null };
        }
        if (!session) {
            return { title: t('errors.sessionDeleted'), isConnected: false, flavor: null };
        }
        const isConnected = session.presence === 'online';
        return {
            title: getSessionName(session),
            subtitle: session.metadata?.path ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir) : undefined,
            avatarId: getSessionAvatarId(session),
            onAvatarPress: () => router.push(`/session/${sessionId}/info` as any),
            isConnected,
            flavor: session.metadata?.flavor || null,
            tintColor: isConnected ? '#000' : '#8E8E93'
        };
    }, [session, isDataReady, sessionId, router]);
}

function useSessionViewInnerState(sessionId: string) {
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const realtimeStatus = useRealtimeStatus();
    const isTablet = useIsTablet();
    const [anchor, setAnchor] = React.useState<SessionActionsAnchor | null>(null);
    const headerProps = useHeaderProps(session, isDataReady, sessionId);
    const closeSidebar = useRightSidebar((s) => s.close);
    const closeDetail = useDetailView((s) => s.close);
    React.useEffect(() => { closeSidebar(); closeDetail(); }, [sessionId, closeSidebar, closeDetail]);
    return { session, isDataReady, realtimeStatus, isTablet, anchor, setAnchor, headerProps };
}

function SessionViewInner({ id }: { id: string }) {
    const s = useSessionViewInnerState(id);
    return (
        <>
            <LandscapeStatusBarShadow />
            <SessionHeader
                headerProps={s.headerProps} session={s.session}
                anchor={s.anchor} setAnchor={s.setAnchor}
                isTablet={s.isTablet} realtimeStatus={s.realtimeStatus}
            />
            <SessionContent
                isDataReady={s.isDataReady} session={s.session} sessionId={id}
                realtimeStatus={s.realtimeStatus} isTablet={s.isTablet}
            />
            <SessionActionsOverlay session={s.session} anchor={s.anchor} setAnchor={s.setAnchor} />
        </>
    );
}

function SessionActionsOverlay({ session, anchor, setAnchor }: {
    session: Session | null; anchor: SessionActionsAnchor | null; setAnchor: (a: SessionActionsAnchor | null) => void;
}) {
    const router = useRouter();
    if (Platform.OS !== 'web' || !session) return null;
    return (
        <SessionActionsPopover
            anchor={anchor}
            onAfterArchive={() => { setAnchor(null); router.replace('/'); }}
            onAfterDelete={() => { setAnchor(null); router.replace('/'); }}
            onClose={() => setAnchor(null)}
            session={session} visible={!!anchor}
        />
    );
}

function LandscapeStatusBarShadow() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    if (!(isLandscape && deviceType === 'phone')) return null;
    return (
        <View style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: safeArea.top, backgroundColor: theme.colors.surface, zIndex: 1000,
            shadowColor: theme.colors.shadow.color, shadowOffset: { width: 0, height: 2 },
            shadowOpacity: theme.colors.shadow.opacity, shadowRadius: 3, elevation: 5,
        }} />
    );
}

function SessionHeader({ headerProps, session, anchor, setAnchor, isTablet, realtimeStatus }: {
    headerProps: any; session: Session | null;
    anchor: SessionActionsAnchor | null; setAnchor: (a: SessionActionsAnchor | null) => void;
    isTablet: boolean; realtimeStatus: string;
}) {
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const router = useRouter();
    if (isLandscape && deviceType === 'phone' && Platform.OS !== 'web') return null;
    return (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }}>
            <ChatHeaderView
                {...headerProps} onBackPress={() => router.back()}
                avatarMenuExpanded={Platform.OS === 'web' && !!anchor} avatarMenuSession={session}
                onAfterAvatarArchive={() => { setAnchor(null); router.replace('/'); }}
                onAfterAvatarDelete={() => { setAnchor(null); router.replace('/'); }}
                onAvatarMenuRequest={Platform.OS === 'web' && session ? setAnchor : undefined}
            />
            {!isTablet && realtimeStatus !== 'disconnected' && <VoiceAssistantStatusBar variant="full" />}
        </View>
    );
}

function SessionContent({ isDataReady, session, sessionId, realtimeStatus, isTablet }: {
    isDataReady: boolean; session: Session | null; sessionId: string; realtimeStatus: string; isTablet: boolean;
}) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const showHeader = !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web');
    const voiceBarH = !isTablet && realtimeStatus !== 'disconnected' ? 32 : 0;
    const pt = showHeader ? safeArea.top + headerHeight + voiceBarH : 0;
    return (
        <View style={{ flex: 1, paddingTop: pt }}>
            {!isDataReady ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            ) : !session ? <SessionDeletedView /> : (
                <SessionViewLoaded key={sessionId} sessionId={sessionId} session={session} />
            )}
        </View>
    );
}

function SessionDeletedView() {
    const { theme } = useUnistyles();
    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
        </View>
    );
}

function useModesAndModels(session: Session) {
    const flavor = session.metadata?.flavor;
    const models = React.useMemo(() => getAvailableModels(flavor, session.metadata, t), [flavor, session.metadata]);
    const modes = React.useMemo(() => getAvailablePermissionModes(flavor, session.metadata, t), [flavor, session.metadata]);
    const perm = React.useMemo<PermissionMode | null>(() => resolveCurrentOption(modes, [session.permissionMode, session.metadata?.currentOperatingModeCode, getDefaultPermissionModeKey(flavor)]), [modes, session.permissionMode, session.metadata?.currentOperatingModeCode, flavor]);
    const model = React.useMemo<ModelMode | null>(() => resolveCurrentOption(models, [session.modelMode, session.metadata?.currentModelCode, getDefaultModelKey(flavor)]), [models, session.modelMode, session.metadata?.currentModelCode, flavor]);
    return { flavor, models, modes, perm, model };
}

function dismissCliVersion(machineId: string | undefined, cliVersion: string | undefined, ack: Record<string, string>) {
    if (!machineId || !cliVersion) return;
    const updated = Object.assign({}, ack, { [machineId]: cliVersion });
    storage.getState().applyLocalSettings({ acknowledgedCliVersions: updated });
}

function useCliWarning(session: Session) {
    const ack = useLocalSetting('acknowledgedCliVersions');
    const ver = session.metadata?.version;
    const mid = session.metadata?.machineId;
    const outdated = ver && !isVersionSupported(ver, MINIMUM_CLI_VERSION);
    const acknowledged = mid && ack[mid] === ver;
    const shouldShow = outdated && !acknowledged;
    const dismiss = React.useCallback(() => dismissCliVersion(mid, ver, ack), [mid, ver, ack]);
    return { shouldShow, dismiss };
}

function useSessionSettings(sessionId: string, session: Session) {
    const status = useSessionStatus(session);
    const usage = useSessionUsage(sessionId);
    const showCtx = useSetting('alwaysShowContextSize');
    const experiments = useSetting('experiments');
    const expResume = useSetting('expResumeSession');
    const archived = session.metadata?.lifecycleState === 'archived';
    const disconnected = !status.isConnected;
    const inactiveArchived = archived && disconnected;
    const resumeCmd = getResumeCommandBlock(session);
    return { status, usage, showCtx, experiments, expResume, disconnected, inactiveArchived, resumeCmd };
}

function handleVoiceStart(sessionId: string) {
    const p = voiceHooks.onVoiceStarted(sessionId);
    return startRealtimeSession(sessionId, p).then(() => {
        tracking?.capture('voice_session_started', { sessionId });
    });
}

function handleVoiceStop() {
    return stopRealtimeSession().then(() => {
        tracking?.capture('voice_session_stopped');
        voiceHooks.onVoiceStopped();
    });
}

function useMicButton(realtimeStatus: string, sessionId: string) {
    const handlePress = React.useCallback(async () => {
        if (realtimeStatus === 'connecting') return;
        if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
            await handleVoiceStart(sessionId).catch((error) => {
                console.error('Failed to start realtime session:', error);
                Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
            });
        } else if (realtimeStatus === 'connected') {
            await handleVoiceStop();
        }
    }, [realtimeStatus, sessionId]);
    return useMemo(() => ({
        onMicPress: handlePress, isMicActive: realtimeStatus === 'connected' || realtimeStatus === 'connecting',
    }), [handlePress, realtimeStatus]);
}

function SessionViewLoaded({ sessionId, session }: { sessionId: string, session: Session }) {
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const { width } = useWindowDimensions();
    const isDesktop = width >= 901;
    const realtimeStatus = useRealtimeStatus();
    const socketStatus = useSocketStatus();
    const cliWarning = useCliWarning(session);
    const micBtn = useMicButton(realtimeStatus, sessionId);
    // Catch-up trigger: re-run when socket reconnects so the visible session
    // re-fetches incremental messages and bridges any reconnect gap. Previously
    // depended on realtimeStatus (voice realtime), which is unrelated to the
    // websocket reconnect cycle. See spec-20260424-084848 §5.19 / pipeline 7.3.
    React.useLayoutEffect(() => {
        sync.onSessionVisible(sessionId);
        gitStatusSync.getSync(sessionId);
    }, [sessionId, socketStatus]);
    return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={{ flex: 1 }}>
                <CliVersionWarning show={cliWarning.shouldShow} onDismiss={cliWarning.dismiss} isLandscape={isLandscape} deviceType={deviceType} />
                <SessionMainContent session={session} sessionId={sessionId} micBtn={micBtn} bottom={safeArea.bottom} />
                <LandscapeBackButton />
            </View>
            <RightSidebar />
        </View>
    );
}

const cliWarningStyle = {
    position: 'absolute' as const, top: 8, alignSelf: 'center' as const,
    backgroundColor: '#FFF3CD', borderRadius: 100,
    paddingHorizontal: 14, paddingVertical: 7,
    flexDirection: 'row' as const, alignItems: 'center' as const, zIndex: 998,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
};

function CliVersionWarning({ show, onDismiss, isLandscape, deviceType }: {
    show: boolean | "" | undefined; onDismiss: () => void; isLandscape: boolean; deviceType: string;
}) {
    if (!show || (isLandscape && deviceType === 'phone')) return null;
    return (
        <Pressable onPress={onDismiss} style={cliWarningStyle}>
            <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
            <Text style={{ fontSize: 12, color: '#856404', fontWeight: '600' }}>{t('sessionInfo.cliVersionOutdated')}</Text>
            <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
        </Pressable>
    );
}

// Search for a message by ID recursively through children
function findInChildren(messages: any[], id: string): any | null {
    for (const m of messages) {
        if (m.id === id) return m;
        if (m.kind === 'tool-call' && m.children) {
            const found = findInChildren(m.children, id);
            if (found) return found;
        }
    }
    return null;
}

// Header bar for the inline detail view with back button, tool name, and status
function InlineDetailHeader({ tool, onBack }: { tool: any; onBack: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
        }}>
            <Pressable onPress={onBack} hitSlop={8}>
                <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
                <ToolHeader tool={tool} />
            </View>
            <ToolStatusIndicator tool={tool} />
        </View>
    );
}

// Inline detail view rendered in the middle area on desktop
// so the right sidebar stays visible when viewing tool details
function InlineDetailView({ messages }: { messages: any[] }) {
    const detailMessageId = useDetailView((s) => s.messageId);
    const closeDetail = useDetailView((s) => s.close);
    const message = detailMessageId ? findInChildren(messages, detailMessageId) : null;

    if (!message || message.kind !== 'tool-call' || !message.tool) return null;

    return (
        <View style={{ flex: 1 }}>
            <InlineDetailHeader tool={message.tool} onBack={closeDetail} />
            <Deferred>
                <ToolFullView tool={message.tool} messages={message.children} />
            </Deferred>
        </View>
    );
}

function useMainContentData(sessionId: string) {
    const { messages, isLoaded } = useSessionMessages(sessionId);
    const detailIsOpen = useDetailView((s) => s.isOpen);
    const openSidebar = useRightSidebar((s) => s.open);
    const handleContentPress = React.useCallback((data: { tool: any; messages: any[]; metadata: any; sessionId: string }) => {
        openSidebar(data);
    }, [openSidebar]);
    return { messages, isLoaded, detailIsOpen, handleContentPress };
}

function SessionMainContent({ session, sessionId, micBtn, bottom }: {
    session: Session; sessionId: string;
    micBtn: { onMicPress: () => void; isMicActive: boolean }; bottom: number;
}) {
    const { theme } = useUnistyles();
    const { messages, isLoaded, detailIsOpen, handleContentPress } = useMainContentData(sessionId);
    const padBottom = bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 8 : 0);

    if (detailIsOpen) {
        return (
            <View style={{ flexBasis: 0, flexGrow: 1, paddingBottom: padBottom }}>
                <InlineDetailView messages={messages} />
            </View>
        );
    }

    const content = (<Deferred>{messages.length > 0 && <ChatList session={session} onContentPress={handleContentPress} />}</Deferred>);
    const placeholder = messages.length === 0 ? (isLoaded ? <EmptyMessages session={session} /> : <ActivityIndicator size="small" color={theme.colors.textSecondary} />) : null;
    const input = (<SessionInputArea session={session} sessionId={sessionId} micBtn={micBtn} />);
    return (
        <View style={{ flexBasis: 0, flexGrow: 1, paddingBottom: padBottom }}>
            <AgentContentView content={content} input={input} placeholder={placeholder} />
        </View>
    );
}

function SessionInputArea({ session, sessionId, micBtn }: {
    session: Session; sessionId: string; micBtn: { onMicPress: () => void; isMicActive: boolean };
}) {
    const s = useSessionSettings(sessionId, session);
    const composer = (<SessionComposer session={session} sessionId={sessionId} micBtn={micBtn} settings={s} />);
    if (s.inactiveArchived) {
        return (
            <>
                <CenteredInputWidth>
                    <InactiveArchivedHint resumeCommandBlock={s.expResume ? s.resumeCmd : null} />
                </CenteredInputWidth>
                {composer}
            </>
        );
    }
    return (
        <>
            {s.expResume && s.disconnected && s.resumeCmd && (
                <CenteredInputWidth>
                    <ResumeCommandHint resumeCommandBlock={s.resumeCmd} />
                </CenteredInputWidth>
            )}
            {composer}
        </>
    );
}

function useComposerCallbacks(sessionId: string) {
    const upPerm = React.useCallback((mode: PermissionMode) => { storage.getState().updateSessionPermissionMode(sessionId, mode.key); }, [sessionId]);
    const upModel = React.useCallback((mode: ModelMode) => { storage.getState().updateSessionModelMode(sessionId, mode.key); }, [sessionId]);
    return { upPerm, upModel };
}

// Inline attachment-error messages. The 10-language translation files all
// exceed the global quality-gate's 800-line file cap, so new translation keys
// cannot be added without a separate translation-splitting refactor. This
// helper uses the current language (getCurrentLanguage) to give users at least
// English + their locale; keys will be migrated into translations/*.ts once
// that refactor lands. See dev-report-20260424-143000-13 for context.
const ATTACHMENT_MESSAGES: Record<string, { oversize: string; uploadFailed: string }> = {
    en: { oversize: 'File exceeds 10 MB limit. Please choose a smaller file.', uploadFailed: 'Some files failed to upload. Remove them before sending.' },
    'zh-Hans': { oversize: '文件超过 10 MB 上限，请选择更小的文件。', uploadFailed: '部分文件上传失败，请先移除再发送。' },
    'zh-Hant': { oversize: '檔案超過 10 MB 上限，請選擇更小的檔案。', uploadFailed: '部分檔案上傳失敗，請先移除再傳送。' },
    ru: { oversize: 'Файл превышает лимит 10 МБ. Выберите файл поменьше.', uploadFailed: 'Не удалось загрузить некоторые файлы. Удалите их перед отправкой.' },
    pl: { oversize: 'Plik przekracza limit 10 MB. Wybierz mniejszy plik.', uploadFailed: 'Nie udało się przesłać niektórych plików. Usuń je przed wysłaniem.' },
    es: { oversize: 'El archivo supera el límite de 10 MB. Elija un archivo más pequeño.', uploadFailed: 'Algunos archivos no se pudieron subir. Elimínelos antes de enviar.' },
    ca: { oversize: 'El fitxer supera el límit de 10 MB. Trieu un fitxer més petit.', uploadFailed: 'No s\'han pogut pujar alguns fitxers. Elimineu-los abans d\'enviar.' },
    it: { oversize: 'Il file supera il limite di 10 MB. Scegli un file più piccolo.', uploadFailed: 'Alcuni file non sono stati caricati. Rimuovili prima di inviare.' },
    pt: { oversize: 'O arquivo excede o limite de 10 MB. Escolha um arquivo menor.', uploadFailed: 'Alguns arquivos falharam no upload. Remova-os antes de enviar.' },
    ja: { oversize: 'ファイルが10 MBの上限を超えています。小さいファイルを選んでください。', uploadFailed: '一部のファイルのアップロードに失敗しました。削除してから送信してください。' },
};
function attachmentMessage(kind: 'oversize' | 'uploadFailed'): string {
    const lang = getCurrentLanguage();
    const table = ATTACHMENT_MESSAGES[lang] ?? ATTACHMENT_MESSAGES.en;
    return table[kind];
}

function useComposerSend(sessionId: string, msg: string, setMsg: (m: string) => void, clearDraft: () => void, att: ReturnType<typeof useAttachments>) {
    return React.useCallback(() => {
        if (!(msg.trim() || att.hasAttachments)) return;
        // Bug §5.12.3: block send when any attachment upload failed. Without this
        // guard the failed chip is silently dropped by clearAttachments() below.
        if (att.hasErrorAttachments) {
            Modal.alert(t('common.error'), attachmentMessage('uploadFailed'), [{ text: 'OK', style: 'cancel' }]);
            return;
        }
        const toSend = att.readyAttachments.length > 0 ? att.readyAttachments : undefined;
        setMsg('');
        clearDraft();
        att.clearAttachments();
        sync.sendMessage(sessionId, msg, undefined, toSend);
        trackMessageSent();
    }, [sessionId, msg, setMsg, clearDraft, att]);
}

// Bug §5.12.2: silent oversize-upload now surfaces via a Modal.alert.
// Passed as `onRejected` to useAttachments so the hook stays UI-layer-free.
function useAttachmentRejectedHandler() {
    return React.useCallback((reason: 'oversize') => {
        if (reason === 'oversize') {
            Modal.alert(t('common.error'), attachmentMessage('oversize'), [{ text: 'OK', style: 'cancel' }]);
        }
    }, []);
}

function resolveUsageData(su: any, lu: any) {
    const src = su || lu;
    if (!src) return undefined;
    return { inputTokens: src.inputTokens, outputTokens: src.outputTokens, cacheCreation: src.cacheCreation, cacheRead: src.cacheRead, contextSize: src.contextSize };
}

function SessionComposer({ session, sessionId, micBtn, settings }: {
    session: Session; sessionId: string;
    micBtn: { onMicPress: () => void; isMicActive: boolean };
    settings: ReturnType<typeof useSessionSettings>;
}) {
    const router = useRouter();
    const [msg, setMsg] = React.useState('');
    const { clearDraft } = useDraft(sessionId, msg, setMsg);
    const onAttachmentRejected = useAttachmentRejectedHandler();
    const att = useAttachments(sessionId, onAttachmentRejected);
    const m = useModesAndModels(session);
    const cbs = useComposerCallbacks(sessionId);
    const onSend = useComposerSend(sessionId, msg, setMsg, clearDraft, att);
    const usage = resolveUsageData(settings.usage, session.latestUsage);
    const conn = { text: settings.status.statusText, color: settings.status.statusColor, dotColor: settings.status.statusDotColor, isPulsing: settings.status.isPulsing };
    const abort = settings.status.state === 'thinking' || settings.status.state === 'waiting';
    return (
        <ComposerInput session={session} sessionId={sessionId} msg={msg} setMsg={setMsg}
            m={m} cbs={cbs} onSend={onSend} conn={conn} abort={abort}
            micBtn={micBtn} settings={settings} usage={usage} att={att} router={router}
        />
    );
}

function ComposerInput({ session, sessionId, msg, setMsg, m, cbs, onSend, conn, abort, micBtn, settings, usage, att, router }: {
    session: Session; sessionId: string; msg: string; setMsg: (m: string) => void;
    m: ReturnType<typeof useModesAndModels>; cbs: ReturnType<typeof useComposerCallbacks>;
    onSend: () => void; conn: any; abort: boolean;
    micBtn: { onMicPress: () => void; isMicActive: boolean };
    settings: ReturnType<typeof useSessionSettings>; usage: any; att: ReturnType<typeof useAttachments>; router: any;
}) {
    return (
        <AgentInput
            placeholder={t('session.inputPlaceholder')} value={msg} onChangeText={setMsg}
            sessionId={sessionId} permissionMode={m.perm} onPermissionModeChange={cbs.upPerm}
            availableModes={m.modes} modelMode={m.model} availableModels={m.models}
            onModelModeChange={cbs.upModel} metadata={session.metadata}
            connectionStatus={conn} blockSend={settings.disconnected} onSend={onSend}
            onMicPress={settings.disconnected ? undefined : micBtn.onMicPress}
            isMicActive={settings.disconnected ? false : micBtn.isMicActive}
            onAbort={settings.disconnected ? undefined : () => sessionAbort(sessionId)}
            showAbortButton={abort}
            onFileViewerPress={settings.experiments ? () => router.push(`/session/${sessionId}/files` as any) : undefined}
            autocompletePrefixes={['@', '/']} autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
            usageData={usage} alwaysShowContextSize={settings.showCtx}
            pendingAttachments={att.attachments} onAttachImage={att.pickImage}
            onAttachDocument={att.pickDocument} onRemoveAttachment={att.removeAttachment} onFilePaste={att.addFileFromPaste}
        />
    );
}

const backBtnShadow = Platform.OS === 'ios' ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 } : { elevation: 2 };

function LandscapeBackButton() {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const router = useRouter();
    if (!(isLandscape && deviceType === 'phone')) return null;
    return (
        <Pressable
            onPress={() => router.back()}
            style={{
                position: 'absolute', top: safeArea.top + 8, left: 16,
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: 'rgba(' + (theme.dark ? '28, 23, 28' : '255, 255, 255') + ', 0.9)',
                alignItems: 'center', justifyContent: 'center', ...backBtnShadow,
            }}
            hitSlop={15}
        >
            <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={Platform.select({ ios: 28, default: 24 })} color="#000" />
        </Pressable>
    );
}

function ResumeCommandHint({ resumeCommandBlock }: { resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>> }) {
    const { theme } = useUnistyles();
    return (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 8 }}>
            <ResumeCommandCopyBlock resumeCommandBlock={resumeCommandBlock} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8 }}>
                Run this command in your terminal to resume this session
            </Text>
        </View>
    );
}

function InactiveArchivedHint(props: { resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>> | null }) {
    const { theme } = useUnistyles();
    const s = { color: theme.colors.agentEventText, fontSize: 13, lineHeight: 18, textAlign: 'left' as const };
    return (
        <View style={{ paddingTop: 12, paddingBottom: 10, gap: 10, alignItems: 'stretch' }}>
            <View style={{ paddingHorizontal: 8, gap: 4 }}>
                <Text style={s}>{t('session.inactiveArchived')}</Text>
                {props.resumeCommandBlock && <Text style={s}>{t('session.resumeFromTerminal')}</Text>}
            </View>
            {props.resumeCommandBlock && <ResumeCommandCopyBlock resumeCommandBlock={props.resumeCommandBlock} />}
        </View>
    );
}

const copyBlockStyle = { minHeight: 48, borderRadius: 14, flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'flex-start' as const };

function ResumeCommandCopyBlock({ resumeCommandBlock }: { resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>> }) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);
    return (
        <Pressable
            onPress={async () => { await Clipboard.setStringAsync(resumeCommandBlock.copyText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            style={[copyBlockStyle, { backgroundColor: theme.colors.surfaceHigh }]}
        >
            <ResumeCommandLines lines={resumeCommandBlock.lines} />
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? '#30D158' : theme.colors.textSecondary} style={{ marginTop: 1 }} />
        </Pressable>
    );
}

function ResumeCommandLines({ lines }: { lines: string[] }) {
    const { theme } = useUnistyles();
    return (
        <View style={{ flex: 1 }}>
            {lines.map((line, i) => (
                <Text key={line + '-' + i} style={{ color: theme.colors.text, fontSize: 13, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{line}</Text>
            ))}
        </View>
    );
}

// Resume / inactive-archived hints share the conversation column geometry (M5):
// the same shared chat-content width as the header, message column and composer,
// CENTERED with no outer horizontal padding, so the hint shares the centered
// reading column geometry instead of being left-anchored / full-bleed.
function CenteredInputWidth(props: { children: React.ReactNode }) {
    const chatContentMaxWidth = useChatContentWidth();
    return (
        <View style={{ width: '100%', alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: chatContentMaxWidth }}>{props.children}</View>
        </View>
    );
}

