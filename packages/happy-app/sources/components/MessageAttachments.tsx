import * as React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { AttachmentMetadata } from '@slopus/happy-wire';

type Props = {
    attachments: AttachmentMetadata[];
};

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders file/image attachments within a message bubble.
 * Images show as thumbnails; other files show as compact cards.
 */
export const MessageAttachments = React.memo(({ attachments }: Props) => {
    if (!attachments || attachments.length === 0) return null;

    const images = attachments.filter(a => a.mimeType.startsWith('image/'));
    const files = attachments.filter(a => !a.mimeType.startsWith('image/'));

    return (
        <View style={styles.container}>
            {images.map(att => (
                <ImageAttachment key={att.id} attachment={att} />
            ))}
            {files.map(att => (
                <FileAttachment key={att.id} attachment={att} />
            ))}
        </View>
    );
});

const ImageAttachment = React.memo(({ attachment }: { attachment: AttachmentMetadata }) => (
    <View style={styles.imageWrapper}>
        <Image
            source={{ uri: attachment.url }}
            style={{ width: 200, height: 150 }}
            contentFit="cover"
        />
        <Text style={styles.imageLabel} numberOfLines={1}>{attachment.filename}</Text>
    </View>
));

function getFileIcon(mimeType: string): keyof typeof Ionicons.glyphMap {
    if (mimeType === 'application/pdf') return 'document-text-outline';
    if (mimeType.startsWith('audio/')) return 'musical-notes-outline';
    if (mimeType.startsWith('video/')) return 'videocam-outline';
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('compress')) return 'archive-outline';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'grid-outline';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'easel-outline';
    if (mimeType.includes('word') || mimeType.includes('document') || mimeType === 'application/rtf') return 'document-outline';
    if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return 'code-slash-outline';
    return 'attach-outline';
}

const FileAttachment = React.memo(({ attachment }: { attachment: AttachmentMetadata }) => (
    <View style={styles.fileCard}>
        <Ionicons name={getFileIcon(attachment.mimeType)} size={20} color="#666" />
        <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>{attachment.filename}</Text>
            <Text style={styles.fileSize}>{formatBytes(attachment.size)}</Text>
        </View>
    </View>
));

const styles = StyleSheet.create(theme => ({
    container: {
        marginBottom: 4,
        gap: 6,
    },
    imageWrapper: {
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        width: 200,
    },
    imageLabel: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        padding: 4,
        backgroundColor: 'rgba(0,0,0,0.04)',
    },
    fileCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    fileInfo: {
        flex: 1,
    },
    fileName: {
        fontSize: 13,
        fontWeight: '500',
        color: theme.colors.text,
    },
    fileSize: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
}));
