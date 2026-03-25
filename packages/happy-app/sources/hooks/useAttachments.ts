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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const SAVE_DEBOUNCE_MS = 1000;

/**
 * Reads a URI as base64. On web, fetches the blob and converts;
 * on native, uses expo-file-system.
 */
async function readAsBase64(uri: string): Promise<string> {
    if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
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
    // Use server URL as preview fallback for images
    if (att.mimeType.startsWith('image/') && att.metadata?.url) {
        return { ...att, previewUri: att.metadata.url };
    }
    return att;
}

/** Save all session attachments to MMKV */
function persistAttachments(sessionId: string, atts: PendingAttachment[]) {
    const allAttachments = loadSessionAttachments();
    const ready = toPersistedAttachments(atts);
    if (ready.length > 0) {
        allAttachments[sessionId] = ready;
    } else {
        delete allAttachments[sessionId];
    }
    saveSessionAttachments(allAttachments);
}

/**
 * Manages pending attachments for a session's message composer.
 * Handles picking, uploading, pasting, clearing, and persisting attachments.
 *
 * Persistence: ready attachments are saved to MMKV with debouncing,
 * mirroring the useDraft pattern. On mount, persisted attachments
 * are restored with server URLs as preview fallbacks.
 */
export function useAttachments(sessionId: string) {
    const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
    const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSavedRef = React.useRef<string>('');

    const updateAttachment = React.useCallback((id: string, update: Partial<PendingAttachment>) => {
        setAttachments(prev => prev.map(a => a.id === id ? { ...a, ...update } : a));
    }, []);

    const removeAttachment = React.useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    }, []);

    const clearAttachments = React.useCallback(() => {
        setAttachments([]);
        // Clear persisted attachments immediately
        persistAttachments(sessionId, []);
        lastSavedRef.current = '[]';
    }, [sessionId]);

    // Load persisted attachments on mount
    React.useEffect(() => {
        const allAttachments = loadSessionAttachments();
        const saved = allAttachments[sessionId];
        if (saved && saved.length > 0) {
            const restored = saved.map(restorePreviewUri);
            setAttachments(restored);
            lastSavedRef.current = JSON.stringify(toPersistedAttachments(restored));
        }
    }, [sessionId]);

    // Debounced save on attachment state changes
    React.useEffect(() => {
        const serialized = JSON.stringify(toPersistedAttachments(attachments));
        if (serialized === lastSavedRef.current) return;

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            persistAttachments(sessionId, attachments);
            lastSavedRef.current = serialized;
        }, SAVE_DEBOUNCE_MS);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [attachments, sessionId]);

    // Save immediately on unmount
    React.useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            persistAttachments(sessionId, attachments);
        };
    }, [sessionId, attachments]);

    // Save on app backgrounding
    React.useEffect(() => {
        const handler = (state: AppStateStatus) => {
            if (state === 'background' || state === 'inactive') {
                if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                persistAttachments(sessionId, attachments);
            }
        };
        const sub = AppState.addEventListener('change', handler);
        return () => sub.remove();
    }, [sessionId, attachments]);

    const uploadFile = React.useCallback(async (
        id: string, uri: string, filename: string, mimeType: string, size: number,
    ) => {
        try {
            const base64 = await readAsBase64(uri);
            const metadata = await sync.uploadAttachment(sessionId, filename, base64, mimeType, size);
            updateAttachment(id, { status: 'ready', metadata });
        } catch (e: any) {
            updateAttachment(id, { status: 'error', error: e?.message || 'Upload failed' });
        }
    }, [sessionId, updateAttachment]);

    const pickImage = React.useCallback(async () => {
        if (Platform.OS !== 'web') {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.8,
            allowsMultipleSelection: false,
            base64: false,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        if ((asset.fileSize ?? 0) > MAX_UPLOAD_BYTES) return;
        const filename = asset.fileName ?? `image-${Date.now()}.jpg`;
        const mimeType = asset.mimeType ?? 'image/jpeg';
        const id = `att-${Date.now()}`;
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: asset.fileSize ?? 0,
            previewUri: asset.uri, status: 'uploading',
        }]);
        await uploadFile(id, asset.uri, filename, mimeType, asset.fileSize ?? 0);
    }, [uploadFile]);

    const pickDocument = React.useCallback(async () => {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        if ((asset.size ?? 0) > MAX_UPLOAD_BYTES) return;
        const filename = asset.name;
        const mimeType = asset.mimeType ?? 'application/octet-stream';
        const id = `att-${Date.now()}`;
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: asset.size ?? 0, status: 'uploading',
        }]);
        await uploadFile(id, asset.uri, filename, mimeType, asset.size ?? 0);
    }, [uploadFile]);

    const addFileFromPaste = React.useCallback(async (file: File) => {
        if (file.size > MAX_UPLOAD_BYTES) return;
        const id = `att-${Date.now()}`;
        const filename = file.name || `pasted-${Date.now()}`;
        const mimeType = file.type || 'application/octet-stream';
        const previewUri = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        setAttachments(prev => [...prev, {
            id, filename, mimeType, size: file.size,
            previewUri, status: 'uploading',
        }]);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result as string;
                    resolve(dataUrl.split(',')[1] || '');
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const metadata = await sync.uploadAttachment(sessionId, filename, base64, mimeType, file.size);
            updateAttachment(id, { status: 'ready', metadata });
        } catch (e: any) {
            updateAttachment(id, { status: 'error', error: e?.message || 'Upload failed' });
        }
    }, [sessionId, updateAttachment]);

    const readyAttachments = React.useMemo(
        () => attachments.filter(a => a.status === 'ready' && a.metadata).map(a => a.metadata!),
        [attachments]
    );

    return {
        attachments, readyAttachments, pickImage, pickDocument,
        removeAttachment, clearAttachments, hasAttachments: attachments.length > 0,
        addFileFromPaste,
    };
}
