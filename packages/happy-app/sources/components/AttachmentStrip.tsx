import * as React from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView, Image } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { PendingAttachment } from '@/hooks/useAttachments';

type Props = {
    attachments: PendingAttachment[];
    onRemove: (id: string) => void;
};

/**
 * Horizontal strip showing pending attachments above the message input.
 * Each attachment shows a thumbnail (images) or file icon, upload spinner, and remove button.
 */
export const AttachmentStrip = React.memo(({ attachments, onRemove }: Props) => {
    if (attachments.length === 0) return null;

    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
            {attachments.map(att => (
                <AttachmentChip key={att.id} attachment={att} onRemove={onRemove} />
            ))}
        </ScrollView>
    );
});

const AttachmentChip = React.memo(({ attachment, onRemove }: {
    attachment: PendingAttachment;
    onRemove: (id: string) => void;
}) => {
    const isImage = attachment.mimeType.startsWith('image/');
    // Use previewUri if available, fall back to server URL for restored attachments
    const imageUri = attachment.previewUri || (isImage ? attachment.metadata?.url : undefined);

    return (
        <View style={styles.chip}>
            {isImage && imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.preview} />
            ) : (
                <View style={styles.fileIcon}>
                    <Ionicons name="document-outline" size={24} color="#666" />
                </View>
            )}

            {attachment.status === 'uploading' && (
                <View style={styles.overlay}>
                    <ActivityIndicator size="small" color="#fff" />
                </View>
            )}

            {attachment.status === 'error' && (
                <View style={styles.overlay}>
                    <Ionicons name="alert-circle" size={20} color="#ff3b30" />
                </View>
            )}

            <Text style={styles.name} numberOfLines={1}>{attachment.filename}</Text>

            <Pressable style={styles.removeBtn} onPress={() => onRemove(attachment.id)} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#888" />
            </Pressable>
        </View>
    );
});

const styles = StyleSheet.create(theme => ({
    strip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        flexDirection: 'row',
    },
    chip: {
        marginRight: 8,
        width: 72,
        alignItems: 'center',
    },
    preview: {
        width: 64,
        height: 64,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
    },
    fileIcon: {
        width: 64,
        height: 64,
        borderRadius: 8,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overlay: {
        position: 'absolute',
        top: 0,
        left: 4,
        width: 64,
        height: 64,
        borderRadius: 8,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    name: {
        fontSize: 10,
        color: theme.colors.textSecondary,
        marginTop: 2,
        width: 64,
        textAlign: 'center',
    },
    removeBtn: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
}));
