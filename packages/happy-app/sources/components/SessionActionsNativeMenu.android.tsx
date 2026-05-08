import * as React from 'react';
import { Button, ContextMenu } from '@expo/ui/jetpack-compose';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canCopySessionMetadata,
        canShowResume,
        copySessionMetadata,
        openDetails,
        resumeSession,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });
    const menuItems = [
        <Button key="details" onPress={openDetails}>Details</Button>,
        ...(canArchive ? [<Button key="archive" onPress={archiveSession}>Archive</Button>] : []),
        ...(canShowResume ? [<Button key="resume" onPress={resumeSession}>Resume</Button>] : []),
        ...(canCopySessionMetadata
            ? [<Button key="copy" onPress={copySessionMetadata}>{t('sessionInfo.copyMetadata')}</Button>]
            : []),
    ];

    return (
        <ContextMenu>
            <ContextMenu.Items>{menuItems}</ContextMenu.Items>
            <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
        </ContextMenu>
    );
}
