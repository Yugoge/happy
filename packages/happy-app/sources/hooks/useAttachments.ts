import * as React from 'react';
import { AttachmentMetadata } from '@slopus/happy-wire';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { sync } from '@/sync/sync';

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

/**
 * Manages pending attachments for a session's message composer.
 * Handles picking, uploading, and clearing attachments.
 */
export function useAttachments(sessionId: string) {
    const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);

    const updateAttachment = React.useCallback((id: string, update: Partial<PendingAttachment>) => {
        setAttachments(prev => prev.map(a => a.id === id ? { ...a, ...update } : a));
    }, []);

    const removeAttachment = React.useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    }, []);

    const clearAttachments = React.useCallback(() => {
        setAttachments([]);
    }, []);

    const uploadFile = React.useCallback(async (
        id: string, uri: string, filename: string, mimeType: string, size: number,
    ) => {
        try {
            const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
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

    const readyAttachments = React.useMemo(
        () => attachments.filter(a => a.status === 'ready' && a.metadata).map(a => a.metadata!),
        [attachments]
    );

    return {
        attachments, readyAttachments, pickImage, pickDocument,
        removeAttachment, clearAttachments, hasAttachments: attachments.length > 0,
    };
}
