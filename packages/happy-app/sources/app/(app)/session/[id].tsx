import * as React from 'react';
import { useLocalSearchParams } from "expo-router";
import { SessionView } from '@/-session/SessionView';


export default React.memo(() => {
    // Use expo-router's useLocalSearchParams instead of useRoute() from @react-navigation/native.
    // useRoute() does not react to param changes when the screen is reused via dangerouslySingular,
    // causing direct URL navigation and sidebar switching to display the wrong session.
    // Root cause: commits 7f178466 / c6c99ee4 (useRoute predates Expo Router migration).
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    return (<SessionView id={sessionId!} />);
});