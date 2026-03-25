import { useAuth } from '@/auth/AuthContext';
import * as React from 'react';
import { Drawer } from 'expo-router/drawer';
import { useIsTablet } from '@/utils/responsive';
import { SidebarView } from './SidebarView';
import { Slot } from 'expo-router';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { useLocalSettingMutable } from '@/sync/storage';
import { useUnistyles } from 'react-native-unistyles';
import { Image } from 'expo-image';

export const SidebarNavigator = React.memo(() => {
    const auth = useAuth();
    const isTablet = useIsTablet();
    const [sidebarCollapsed, setSidebarCollapsed] = useLocalSettingMutable('sidebarCollapsed');
    const showPermanentDrawer = auth.isAuthenticated && isTablet;
    const isCollapsed = showPermanentDrawer && sidebarCollapsed;
    const { width: windowWidth } = useWindowDimensions();
    const { theme } = useUnistyles();

    const drawerWidth = React.useMemo(() => {
        if (!showPermanentDrawer || isCollapsed) return 280;
        return Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);
    }, [windowWidth, showPermanentDrawer, isCollapsed]);

    const drawerNavigationOptions = React.useMemo(() => {
        if (!showPermanentDrawer || isCollapsed) {
            return {
                lazy: false,
                headerShown: false,
                drawerType: 'front' as const,
                swipeEnabled: false,
                drawerStyle: {
                    width: 0,
                    display: 'none' as const,
                },
            };
        }

        return {
            lazy: false,
            headerShown: false,
            drawerType: 'permanent' as const,
            drawerStyle: {
                backgroundColor: 'white',
                borderRightWidth: 0,
                width: drawerWidth,
            },
            swipeEnabled: false,
            drawerActiveTintColor: 'transparent',
            drawerInactiveTintColor: 'transparent',
            drawerItemStyle: { display: 'none' as const },
            drawerLabelStyle: { display: 'none' as const },
        };
    }, [showPermanentDrawer, isCollapsed, drawerWidth]);

    const drawerContent = React.useCallback(
        () => <SidebarView onCollapse={() => setSidebarCollapsed(true)} />,
        [setSidebarCollapsed]
    );

    // Cmd+B / Ctrl+B to toggle sidebar (like VS Code)
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !showPermanentDrawer) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                setSidebarCollapsed(!sidebarCollapsed);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [showPermanentDrawer, sidebarCollapsed, setSidebarCollapsed]);

    return (
        <View style={{ flex: 1 }}>
            <Drawer
                screenOptions={drawerNavigationOptions}
                drawerContent={showPermanentDrawer && !isCollapsed ? drawerContent : undefined}
            />
            {isCollapsed && Platform.OS === 'web' && (
                <Pressable
                    onPress={() => setSidebarCollapsed(false)}
                    style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100,
                        opacity: 0.6,
                    }}
                >
                    <Image
                        source={theme.dark ? require('@/assets/images/logo-white.png') : require('@/assets/images/logo-black.png')}
                        contentFit="contain"
                        style={{ width: 24, height: 24 }}
                    />
                </Pressable>
            )}
        </View>
    )
});
