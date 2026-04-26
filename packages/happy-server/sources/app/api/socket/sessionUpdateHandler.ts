import { sessionAliveEventsCounter, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { activityCache } from "@/app/presence/sessionCache";
import { clearThinking, recordThinking } from "@/app/presence/thinkingCache";
import { buildNewMessageUpdate, buildSessionActivityEphemeral, buildUpdateSessionUpdate, ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { allocateSessionSeq, allocateUserSeq } from "@/storage/seq";
import { AsyncLock } from "@/utils/lock";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { Socket } from "socket.io";

function clampHeartbeatTime(t: number): number | null {
    let v = t;
    if (v > Date.now()) v = Date.now();
    if (v < Date.now() - 1000 * 60 * 10) return null;
    return v;
}

function isValidUpdateMetadataInput(data: any): boolean {
    return data && data.sid && typeof data.metadata === 'string' && typeof data.expectedVersion === 'number';
}

function isValidUpdateStateInput(data: any): boolean {
    if (!data || !data.sid) return false;
    if (typeof data.agentState !== 'string' && data.agentState !== null) return false;
    return typeof data.expectedVersion === 'number';
}

async function emitMetadataUpdate(userId: string, sid: string, metadata: string, newVersion: number): Promise<void> {
    const updSeq = await allocateUserSeq(userId);
    const payload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), { value: metadata, version: newVersion });
    eventRouter.emitUpdate({ userId, payload, recipientFilter: { type: 'all-interested-in-session', sessionId: sid } });
}

async function emitAgentStateUpdate(userId: string, sid: string, agentState: string | null, newVersion: number): Promise<void> {
    const updSeq = await allocateUserSeq(userId);
    // agentState may be null; the wire-protocol field accepts null but the typed
    // signature requires `string`. Mirror the original idiom (inferred local var)
    // to preserve the pre-existing widening behavior.
    const agentStateUpdate = { value: agentState, version: newVersion };
    const payload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, agentStateUpdate as { value: string; version: number });
    eventRouter.emitUpdate({ userId, payload, recipientFilter: { type: 'all-interested-in-session', sessionId: sid } });
}

async function performUpdateMetadata(userId: string, data: any, callback: (response: any) => void): Promise<void> {
    if (!isValidUpdateMetadataInput(data)) {
        if (callback) callback({ result: 'error' });
        return;
    }
    const { sid, metadata, expectedVersion, dataEncryptionKey } = data;
    const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
    if (!session) { if (callback) callback({ result: 'error' }); return; }
    if (session.metadataVersion !== expectedVersion) {
        callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
        return;
    }
    const updateData: Record<string, any> = { metadata, metadataVersion: expectedVersion + 1 };
    if (dataEncryptionKey && typeof dataEncryptionKey === 'string') {
        updateData.dataEncryptionKey = Buffer.from(dataEncryptionKey, 'base64');
    }
    const { count } = await db.session.updateMany({ where: { id: sid, metadataVersion: expectedVersion }, data: updateData });
    if (count === 0) {
        callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
        return;
    }
    await emitMetadataUpdate(userId, sid, metadata, expectedVersion + 1);
    callback({ result: 'success', version: expectedVersion + 1, metadata });
}

async function handleUpdateMetadata(userId: string, data: any, callback: (response: any) => void): Promise<void> {
    try {
        await performUpdateMetadata(userId, data, callback);
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error in update-metadata: ${error}`);
        if (callback) callback({ result: 'error' });
    }
}

async function performUpdateState(userId: string, data: any, callback: (response: any) => void): Promise<void> {
    if (!isValidUpdateStateInput(data)) {
        if (callback) callback({ result: 'error' });
        return;
    }
    const { sid, agentState, expectedVersion } = data;
    const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
    if (!session) { callback({ result: 'error' }); return; }
    if (session.agentStateVersion !== expectedVersion) {
        callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
        return;
    }
    const { count } = await db.session.updateMany({
        where: { id: sid, agentStateVersion: expectedVersion },
        data: { agentState, agentStateVersion: expectedVersion + 1 }
    });
    if (count === 0) {
        callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
        return;
    }
    await emitAgentStateUpdate(userId, sid, agentState, expectedVersion + 1);
    callback({ result: 'success', version: expectedVersion + 1, agentState });
}

async function handleUpdateState(userId: string, data: any, callback: (response: any) => void): Promise<void> {
    try {
        await performUpdateState(userId, data, callback);
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error in update-state: ${error}`);
        if (callback) callback({ result: 'error' });
    }
}

async function performSessionAlive(userId: string, data: { sid: string; time: number; thinking?: boolean }): Promise<void> {
    websocketEventsCounter.inc({ event_type: 'session-alive' });
    sessionAliveEventsCounter.inc();
    if (!data || typeof data.time !== 'number' || !data.sid) return;
    const t = clampHeartbeatTime(data.time);
    if (t === null) return;
    const { sid, thinking } = data;
    const isValid = await activityCache.isSessionValid(sid, userId);
    if (!isValid) return;
    activityCache.queueSessionUpdate(sid, t);
    // Pipeline 7.2: cache the transient `thinking` flag so a freshly-connected
    // socket can pick up the in-flight state without waiting for the next
    // heartbeat. See thinkingCache.ts for full rationale.
    recordThinking(sid, userId, thinking || false, t);
    const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false);
    eventRouter.emitEphemeral({ userId, payload: sessionActivity, recipientFilter: { type: 'user-scoped-only' } });
}

async function handleSessionAlive(userId: string, data: any): Promise<void> {
    try {
        await performSessionAlive(userId, data);
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error in session-alive: ${error}`);
    }
}

async function findExistingMessage(sid: string, localId: string | null): Promise<{ id: string } | null> {
    if (!localId) return null;
    return db.sessionMessage.findFirst({ where: { sessionId: sid, localId } });
}

async function persistAndEmitMessage(userId: string, sid: string, message: string, localId: string | null, connection: ClientConnection): Promise<void> {
    const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
    if (!session) return;
    const existing = await findExistingMessage(sid, localId);
    if (existing) return;
    const msgContent: PrismaJson.SessionMessageContent = { t: 'encrypted', c: message };
    const updSeq = await allocateUserSeq(userId);
    const msgSeq = await allocateSessionSeq(sid);
    const msg = await db.sessionMessage.create({ data: { sessionId: sid, seq: msgSeq, content: msgContent, localId } });
    const payload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12));
    eventRouter.emitUpdate({
        userId,
        payload,
        recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
        skipSenderConnection: connection
    });
}

async function performMessage(userId: string, socket: Socket, connection: ClientConnection, data: any): Promise<void> {
    websocketEventsCounter.inc({ event_type: 'message' });
    const { sid, message, localId } = data;
    const sessionTag = connection.connectionType === 'session-scoped' ? connection.sessionId : 'N/A';
    log({ module: 'websocket' }, `Received message from socket ${socket.id}: sessionId=${sid}, messageLength=${message.length} bytes, connectionType=${connection.connectionType}, connectionSessionId=${sessionTag}`);
    const useLocalId = typeof localId === 'string' ? localId : null;
    await persistAndEmitMessage(userId, sid, message, useLocalId, connection);
}

async function handleMessage(userId: string, socket: Socket, connection: ClientConnection, data: any): Promise<void> {
    try {
        await performMessage(userId, socket, connection, data);
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error in message handler: ${error}`);
    }
}

async function performSessionEnd(userId: string, data: { sid: string; time: number }): Promise<void> {
    const { sid, time } = data;
    if (typeof time !== 'number') return;
    const t = clampHeartbeatTime(time);
    if (t === null) return;
    const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
    if (!session) return;
    await db.session.update({ where: { id: sid }, data: { lastActiveAt: new Date(t), active: false } });
    clearThinking(sid);
    const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
    eventRouter.emitEphemeral({ userId, payload: sessionActivity, recipientFilter: { type: 'user-scoped-only' } });
}

async function handleSessionEnd(userId: string, data: any): Promise<void> {
    try {
        await performSessionEnd(userId, data);
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error in session-end: ${error}`);
    }
}

export function sessionUpdateHandler(userId: string, socket: Socket, connection: ClientConnection): void {
    socket.on('update-metadata', (data: any, callback: (response: any) => void) => {
        handleUpdateMetadata(userId, data, callback);
    });
    socket.on('update-state', (data: any, callback: (response: any) => void) => {
        handleUpdateState(userId, data, callback);
    });
    socket.on('session-alive', (data: any) => {
        handleSessionAlive(userId, data);
    });
    const receiveMessageLock = new AsyncLock();
    socket.on('message', (data: any) => {
        receiveMessageLock.inLock(() => handleMessage(userId, socket, connection, data));
    });
    socket.on('session-end', (data: any) => {
        handleSessionEnd(userId, data);
    });
}