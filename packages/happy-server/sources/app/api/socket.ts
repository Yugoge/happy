import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import { buildMachineActivityEphemeral, buildSessionActivityEphemeral, ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { getActivitySnapshotForUser } from "@/app/presence/thinkingCache";
import { Server, Socket } from "socket.io";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { decrementWebSocketConnection, incrementWebSocketConnection, websocketEventsCounter } from "../monitoring/metrics2";
import { usageHandler } from "./socket/usageHandler";
import { rpcHandler } from "./socket/rpcHandler";
import { pingHandler } from "./socket/pingHandler";
import { sessionUpdateHandler } from "./socket/sessionUpdateHandler";
import { machineUpdateHandler } from "./socket/machineUpdateHandler";
import { artifactUpdateHandler } from "./socket/artifactUpdateHandler";
import { accessKeyHandler } from "./socket/accessKeyHandler";

interface AuthHandshake {
    token: string;
    clientType: 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
    sessionId: string | undefined;
    machineId: string | undefined;
}

const SOCKET_OPTIONS = {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        credentials: true,
        allowedHeaders: ["*"]
    },
    transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    pingTimeout: 45000,
    pingInterval: 15000,
    path: '/v1/updates',
    allowUpgrades: true,
    upgradeTimeout: 10000,
    connectTimeout: 20000,
    serveClient: false
};

function readHandshake(socket: Socket): AuthHandshake {
    return {
        token: socket.handshake.auth.token as string,
        clientType: socket.handshake.auth.clientType as AuthHandshake['clientType'],
        sessionId: socket.handshake.auth.sessionId as string | undefined,
        machineId: socket.handshake.auth.machineId as string | undefined
    };
}

function rejectHandshake(socket: Socket, errorMessage: string, logMessage: string): void {
    log({ module: 'websocket' }, logMessage);
    socket.emit('error', { message: errorMessage });
    socket.disconnect();
}

function validateHandshakeShape(socket: Socket, hs: AuthHandshake): boolean {
    if (!hs.token) {
        rejectHandshake(socket, 'Missing authentication token', 'No token provided');
        return false;
    }
    if (hs.clientType === 'session-scoped' && !hs.sessionId) {
        rejectHandshake(socket, 'Session ID required for session-scoped clients', 'Session-scoped client missing sessionId');
        return false;
    }
    if (hs.clientType === 'machine-scoped' && !hs.machineId) {
        rejectHandshake(socket, 'Machine ID required for machine-scoped clients', 'Machine-scoped client missing machineId');
        return false;
    }
    return true;
}

function buildConnection(socket: Socket, userId: string, hs: AuthHandshake): ClientConnection {
    if (hs.clientType === 'session-scoped' && hs.sessionId) {
        return { connectionType: 'session-scoped', socket, userId, sessionId: hs.sessionId };
    }
    if (hs.clientType === 'machine-scoped' && hs.machineId) {
        return { connectionType: 'machine-scoped', socket, userId, machineId: hs.machineId };
    }
    return { connectionType: 'user-scoped', socket, userId };
}

function broadcastMachineOnline(userId: string, machineId: string): void {
    const machineActivity = buildMachineActivityEphemeral(machineId, true, Date.now());
    eventRouter.emitEphemeral({
        userId,
        payload: machineActivity,
        recipientFilter: { type: 'user-scoped-only' }
    });
}

function broadcastMachineOffline(userId: string, machineId: string): void {
    const machineActivity = buildMachineActivityEphemeral(machineId, false, Date.now());
    eventRouter.emitEphemeral({
        userId,
        payload: machineActivity,
        recipientFilter: { type: 'user-scoped-only' }
    });
}

/**
 * Pipeline 7.2: when a user-scoped websocket connects (browser tab open or
 * mobile app foreground), look up the user's recently-active sessions and
 * push the current activity ephemeral (`{ active, activeAt, thinking }`)
 * directly to the new socket. This bridges the reconnect gap so the
 * "claude babbling" indicator can render immediately, without waiting for
 * the next CLI keepAlive heartbeat.
 *
 * Mirrors the existing machine-online snapshot pattern (broadcastMachineOnline)
 * but addressed to the connecting socket only — there is no need to broadcast
 * a session snapshot to other already-open tabs that already know the state.
 *
 * Reuses the existing 'activity' ephemeral shape per QA Objection #3 so no
 * new event handler is required app-side.
 */
async function sendSessionSnapshotsToConnectingSocket(socket: Socket, userId: string): Promise<void> {
    try {
        const snapshot = await getActivitySnapshotForUser(userId);
        for (const row of snapshot) {
            const payload = buildSessionActivityEphemeral(row.sessionId, true, row.activeAt, row.thinking);
            socket.emit('ephemeral', payload);
        }
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error sending session activity snapshot to user ${userId}: ${error}`);
    }
}

function broadcastConnectActivity(socket: Socket, userId: string, connection: ClientConnection, hs: AuthHandshake): void {
    if (connection.connectionType === 'machine-scoped' && hs.machineId) {
        broadcastMachineOnline(userId, hs.machineId);
        return;
    }
    if (connection.connectionType === 'user-scoped') {
        sendSessionSnapshotsToConnectingSocket(socket, userId);
    }
}

function registerDisconnectHandler(socket: Socket, userId: string, connection: ClientConnection): void {
    socket.on('disconnect', (reason) => {
        websocketEventsCounter.inc({ event_type: 'disconnect' });
        eventRouter.removeConnection(userId, connection);
        decrementWebSocketConnection(connection.connectionType);
        log({ module: 'websocket' }, `User disconnected: ${userId}, reason: ${reason}, type: ${connection.connectionType}, socketId: ${socket.id}`);
        if (connection.connectionType === 'machine-scoped') {
            broadcastMachineOffline(userId, connection.machineId);
        }
    });
}

function getOrCreateUserRpcListeners(rpcListeners: Map<string, Map<string, Socket>>, userId: string): Map<string, Socket> {
    let userRpcListeners = rpcListeners.get(userId);
    if (!userRpcListeners) {
        userRpcListeners = new Map<string, Socket>();
        rpcListeners.set(userId, userRpcListeners);
    }
    return userRpcListeners;
}

function registerAllHandlers(socket: Socket, userId: string, connection: ClientConnection, rpcListeners: Map<string, Map<string, Socket>>): void {
    const userRpcListeners = getOrCreateUserRpcListeners(rpcListeners, userId);
    rpcHandler(userId, socket, userRpcListeners);
    usageHandler(userId, socket);
    sessionUpdateHandler(userId, socket, connection);
    pingHandler(socket);
    machineUpdateHandler(userId, socket);
    artifactUpdateHandler(userId, socket);
    accessKeyHandler(userId, socket);
}

async function handleConnection(socket: Socket, rpcListeners: Map<string, Map<string, Socket>>): Promise<void> {
    log({ module: 'websocket' }, `New connection attempt from socket: ${socket.id}`);
    const hs = readHandshake(socket);
    if (!validateHandshakeShape(socket, hs)) return;
    const verified = await auth.verifyToken(hs.token);
    if (!verified) {
        rejectHandshake(socket, 'Invalid authentication token', 'Invalid token provided');
        return;
    }
    const userId = verified.userId;
    log({ module: 'websocket' }, `Token verified: ${userId}, clientType: ${hs.clientType || 'user-scoped'}, sessionId: ${hs.sessionId || 'none'}, machineId: ${hs.machineId || 'none'}, socketId: ${socket.id}`);
    const connection = buildConnection(socket, userId, hs);
    eventRouter.addConnection(userId, connection);
    incrementWebSocketConnection(connection.connectionType);
    broadcastConnectActivity(socket, userId, connection, hs);
    registerDisconnectHandler(socket, userId, connection);
    registerAllHandlers(socket, userId, connection, rpcListeners);
    log({ module: 'websocket' }, `User connected: ${userId}`);
}

export function startSocket(app: Fastify): void {
    const io = new Server(app.server, SOCKET_OPTIONS);
    const rpcListeners = new Map<string, Map<string, Socket>>();
    io.on("connection", (socket) => {
        handleConnection(socket, rpcListeners);
    });
    onShutdown('api', async () => {
        await io.close();
    });
}