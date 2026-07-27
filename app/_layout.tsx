// Root layout — fonts, then Theme > Audio > navigation shell.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  useFonts as usePlayfair,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_900Black,
  PlayfairDisplay_400Regular_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  useFonts as useCormorant,
  CormorantGaramond_500Medium,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import { AuthProvider } from '../lib/auth';
import { ThemeProvider, useTheme } from '../lib/theme-context';
import { AudioProvider } from '../lib/audio';
import { palettes } from '../lib/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function Shell() {
  const { c, mode } = useTheme();
  return (
    <>
      <StatusBar style={mode === 'minuit' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.paper },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const [playfairLoaded] = usePlayfair({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    PlayfairDisplay_400Regular_Italic,
  });
  const [cormorantLoaded] = useCormorant({
    CormorantGaramond_500Medium,
    CormorantGaramond_600SemiBold,
  });

  if (!playfairLoaded || !cormorantLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: palettes.creme.paper }}>
        <ActivityIndicator size="large" color={palettes.creme.wine} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <AudioProvider>
          <Shell />
        </AudioProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
