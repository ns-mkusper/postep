import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { LogBox, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/registerContentUriModule';
import { useBridgeConfig, useOrgConfig } from '../store/orgConfig';
import { hydrateWarmOrgCache, warmOrgConfigKey, warmOrgWorkspace } from '../lib/orgWarmCache';

if (__DEV__ && process.env.EXPO_PUBLIC_POSTEP_E2E === '1') {
  LogBox.ignoreAllLogs(true);
}

function StartupOrgWarmCache() {
  const queryClient = useQueryClient();
  const bridgeConfig = useBridgeConfig();
  const hasHydrated = useOrgConfig((state) => state.hasHydrated);
  const configKey = warmOrgConfigKey(bridgeConfig);
  const config = useMemo(
    () => bridgeConfig,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey],
  );

  useEffect(() => {
    if (!hasHydrated) {
      return undefined;
    }
    let cancelled = false;
    void hydrateWarmOrgCache(queryClient, config)
      .then(() => {
        if (cancelled) {
          return undefined;
        }
        return warmOrgWorkspace(queryClient, config);
      })
      .catch((error) => {
        console.warn('Postep org warm cache skipped', error);
      });
    return () => {
      cancelled = true;
    };
  }, [config, hasHydrated, queryClient]);

  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  }));
  const hydrateOrgConfig = useOrgConfig((state) => state.hydrate);
  const dark = scheme === 'dark';

  useEffect(() => {
    void hydrateOrgConfig();
  }, [hydrateOrgConfig]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StartupOrgWarmCache />
          <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerTintColor: '#F2F5EC',
                headerStyle: { backgroundColor: '#071008' },
                headerTitleStyle: { fontWeight: '800', fontSize: 22 },
                contentStyle: { backgroundColor: '#071008' }
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="library/index" options={{ title: 'Notes', headerShown: false }} />
              <Stack.Screen name="capture/index" options={{ title: 'Capture' }} />
              <Stack.Screen name="agenda/index" options={{ title: 'Agenda' }} />
              <Stack.Screen name="habits/index" options={{ title: 'Habits' }} />
              <Stack.Screen name="roam/index" options={{ title: 'Roam' }} />
              <Stack.Screen name="settings/index" options={{ title: 'Org Settings', headerShown: false }} />
            </Stack>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
