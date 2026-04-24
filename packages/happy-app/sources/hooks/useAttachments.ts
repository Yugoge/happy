import * as React from 'react';
import { AttachmentMetadata } from '@slopus/happy-wire';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { AppState, AppStateStatus } from 'react-native';
import { Platform } from 'react-native';
import { sync } from '@/sync/sync';
import { loadSessionAttachments, saveSessionAttachments } from '@/sync/persistence';

export type PendingAttachment = {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    previewUri?: string; // local URI for image preview
    status: 'uploading' | 'ready' | 'error';
    metadata?: AttachmentMetadata; // populated on success
    error?: string;
};

/** Reason passed to onRejected when a client-side guard rejects a file. */
export type AttachmentRejectionReason = 'oversize';

/** Client-side oversize threshold. Must match server maxBytes in v3SessionRoutes.ts. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const SAVE_DEBOUNCE_MS = 1000;

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Reads a URI as base64. Web: fetch + FileReader. Native: expo-file-system. */
async function readAsBase64(uri: string): Promise<string> {
    if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        return blobToBase64(blob);
    }
    return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
}

/** Filter to only ready attachments and strip non-serializable fields */
function toPersistedAttachments(atts: PendingAttachment[]) {
    return atts
        .filter(a => a.status === 'ready' && a.metadata)
        .map(({ previewUri, ...rest }) => rest);
}

/** Restore previewUri from server URL when loading from persistence */
function restorePreviewUri(att: PendingAttachment): PendingAttachment {
    if (att.previewUri) return att;
    if (att.mimeType.startsWith('image/') && att.metadata?.url) {
        return { ...att, previewUri: att.metadata.url };
    }
    return att;
}

/** Save all session attachments to MMKV */
function persistAttachments(sessionId: string, atts: PendingAttachment[]) {
    const allAttachments = loadSessionAttachments();
    const ready = toPersistedAttachments(atts);
    if (ready.length > 0) allAttachments[sessionId] = ready;
    else delete allAttachments[sessionId];
    saveSessionAttachments(allAttachments);
}

function makeAttachmentId() {
    return `att-${Date.now()}`;
}

type SaveTimeoutRef = React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
type LastSavedRef = React.MutableRefObject<string>;

function useLoadPersistedOnMount(
    sessionId: string,
    setAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>,
    lastSavedRef: LastSavedRef,
) {
    React.useEffect(() => {
        const saved = loadSessionAttachments()[sessionId];
        if (saved && saved.length > 0) {
            const restored = saved.map(restorePreviewUri);
            setAttachments(restored);
            lastSavedRef.current = JSON.stringify(toPersistedAttachments(restored));
        }
    }, [sessionId, setAttachments, lastSavedRef]);
}

function useDebouncedSave(
    sessionId: string,
    attachments: PendingAttachment[],
    saveTimeoutRef: SaveTimeoutRef,
    lastSavedRef: LastSavedRef,
) {
    React.useEffect(() => {
        const serialized = JSON.stringify(toPersistedAttachments(attachments));
        if (serialized === lastSavedRef.current) return;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            persistAttachments(sessionId, attachments);
            lastSavedRef.current = serialized;
        }, SAVE_DEBOUNCE_MS);
        return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
    }, [attachments, sessionId, saveTimeoutRef, lastSavedRef]);
}

function useFlushOnUnmount(sessionId: string, attachments: PendingAttachment[], saveTimeoutRef: SaveTimeoutRef) {
    React.useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            persistAttachments(sessionId, attachments);
        };
    }, [sessionId, attachments, saveTimeoutRef]);
}

function useFlushOnBackground(sessionId: string, attachments: PendingAttachment[], saveTimeoutRef: SaveTimeoutRef) {
    React.useEffect(() => {
        const handler = (state: AppStateStatus) => {
            if (state === 'background' || state === 'inactive') {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                persistAttachments(sessionId, attachments);
            }
        };
        const sub = AppState.addEventListener('change', handler);
        return () => sub.remove();
    }, [sessionId, attachments, saveTimeoutRef]);
}

function useAttachmentPersistence(
    sessionId: string,
    attachments: PendingAttachment[],
    setAttachments: React.Dispatch<React.SetStateAction<PendingAttachment[]>>,
) {
    const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSavedRef = React.useRef<string>('');
    useLoadPersistedOnMount(sessionId, setAttachments, lastSavedRef);
    useDebouncedSave(sessionId, attachments, saveTimeoutRef, lastSavedRef);
    useFlushOnUnmount(sessionId, attachments, saveTimeoutRef);
    useFlushOnBackground(sessionId, attachments, saveTimeoutRef);
}

type UploadFn = (id: string, uri: string, filename: string, mimeType: string, size: number) => Promise<void>;
type RejectedRef = React.MutableRefObject<((reason: AttachmentRejectionReason) => void) | undefined>;
type SetAtts = React.Dispatch<React.SetStateAction<PendingAttachment[]>>;
type UpdateFn = (id: string, update: Partial<PendingAttachment>) => void;

function usePickImage(rejectedRef: RejectedRef, setAttachments: SetAtts, uploadFile: UploadFn) {
    return React.useCallback(async () => {
        if (Platform.OS !== 'web') {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], quality: 0.8,
            allowsMultipleSelection: false, base64: false,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        if ((asset.fileSize ?? 0) > MAX_UPLOAD_BYTES) { rejectedRef.current?.('oversize'); return; }
        const filename = asset.fileName ?? `image-${Date.now()}.jpg`;
        const mimeType = asset.mimeType ?? 'image/jpeg';
        const id = makeAttachmentId();
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: asset.fileSize ?? 0,
            previewUri: asset.uri, status: 'uploading',
        }]);
        await uploadFile(id, asset.uri, filename, mimeType, asset.fileSize ?? 0);
    }, [rejectedRef, setAttachments, uploadFile]);
}

function usePickDocument(rejectedRef: RejectedRef, setAttachments: SetAtts, uploadFile: UploadFn) {
    return React.useCallback(async () => {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        if ((asset.size ?? 0) > MAX_UPLOAD_BYTES) { rejectedRef.current?.('oversize'); return; }
        const filename = asset.name;
        const mimeType = asset.mimeType ?? 'application/octet-stream';
        const id = makeAttachmentId();
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: asset.size ?? 0, status: 'uploading',
        }]);
        await uploadFile(id, asset.uri, filename, mimeType, asset.size ?? 0);
    }, [rejectedRef, setAttachments, uploadFile]);
}

function useAddFileFromPaste(sessionId: string, rejectedRef: RejectedRef, setAttachments: SetAtts, updateAttachment: UpdateFn) {
    return React.useCallback(async (file: File) => {
        if (file.size > MAX_UPLOAD_BYTES) { rejectedRef.current?.('oversize'); return; }
        const id = makeAttachmentId();
        const filename = file.name || `pasted-${Date.now()}`;
        const mimeType = file.type || 'application/octet-stream';
        const previewUri = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: file.size, previewUri, status: 'uploading',
        }]);
        try {
            const base64 = await blobToBase64(file);
            const metadata = await sync.uploadAttachment(sessionId, filename, base64, mimeType, file.size);
            updateAttachment(id, { status: 'ready', metadata });
        } catch (e: any) {
            updateAttachment(id, { status: 'error', error: e?.message || 'Upload failed' });
        }
    }, [sessionId, rejectedRef, setAttachments, updateAttachment]);
}

function useUploadFile(sessionId: string, updateAttachment: UpdateFn): UploadFn {
    return React.useCallback(async (id, uri, filename, mimeType, size) => {
        try {
            const base64 = await readAsBase64(uri);
            const metadata = await sync.uploadAttachment(sessionId, filename, base64, mimeType, size);
            updateAttachment(id, { status: 'ready', metadata });
        } catch (e: any) {
            updateAttachment(id, { status: 'error', error: e?.message || 'Upload failed' });
        }
    }, [sessionId, updateAttachment]);
}

function useAttachmentMutators(sessionId: string, setAttachments: SetAtts) {
    const updateAttachment = React.useCallback((id: string, update: Partial<PendingAttachment>) => {
        setAttachments(prev => prev.map(a => a.id === id ? { ...a, ...update } : a));
    }, [setAttachments]);
    const removeAttachment = React.useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    }, [setAttachments]);
    const clearAttachments = React.useCallback(() => {
        setAttachments([]);
        persistAttachments(sessionId, []);
    }, [sessionId, setAttachments]);
    return { updateAttachment, removeAttachment, clearAttachments };
}

function useDerivedAttachmentState(attachments: PendingAttachment[]) {
    const readyAttachments = React.useMemo(
        () => attachments.filter(a => a.status === 'ready' && a.metadata).map(a => a.metadata!),
        [attachments]
    );
    const hasErrorAttachments = React.useMemo(
        () => attachments.some(a => a.status === 'error'),
        [attachments]
    );
    return { readyAttachments, hasErrorAttachments };
}

/**
 * Manages pending attachments for a session's message composer.
 * Error surfacing: when a picked file exceeds MAX_UPLOAD_BYTES the previously
 * silent `return` now invokes `onRejected('oversize')` so the caller can show
 * a Modal.alert. Chip is NOT added to the tray on rejection. `hasErrorAttachments`
 * lets the send-time guard block send when any chip is in error.
 */
export function useAttachments(
    sessionId: string,
    onRejected?: (reason: AttachmentRejectionReason) => void,
) {
    const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
    useAttachmentPersistence(sessionId, attachments, setAttachments);
    const rejectedRef = React.useRef(onRejected);
    rejectedRef.current = onRejected;
    const { updateAttachment, removeAttachment, clearAttachments } = useAttachmentMutators(sessionId, setAttachments);
    const uploadFile = useUploadFile(sessionId, updateAttachment);
    const pickImage = usePickImage(rejectedRef, setAttachments, uploadFile);
    const pickDocument = usePickDocument(rejectedRef, setAttachments, uploadFile);
    const addFileFromPaste = useAddFileFromPaste(sessionId, rejectedRef, setAttachments, updateAttachment);
    const { readyAttachments, hasErrorAttachments } = useDerivedAttachmentState(attachments);
    return {
        attachments, readyAttachments, pickImage, pickDocument,
        removeAttachment, clearAttachments,
        hasAttachments: attachments.length > 0,
        hasErrorAttachments, addFileFromPaste,
    };
}
