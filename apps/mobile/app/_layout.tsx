import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Drawer } from 'expo-router/drawer';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function RootLayout() {
  const scheme = useColorScheme();
  const [queryClient] = useState(() => new QueryClient());

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Drawer
            initialRouteName="agenda/index"
            screenOptions={{
              headerTintColor: scheme === 'dark' ? '#F5F6FA' : '#111827',
              headerStyle: { backgroundColor: scheme === 'dark' ? '#050607' : '#FFFFFF' },
              sceneContainerStyle: { backgroundColor: scheme === 'dark' ? '#050607' : '#FFFFFF' }
            }}
          >
            <Drawer.Screen name="agenda/index" options={{ title: 'Agenda' }} />
            <Drawer.Screen name="habits/index" options={{ title: 'Habits' }} />
            <Drawer.Screen name="roam/index" options={{ title: 'Roam' }} />
            <Drawer.Screen name="capture/index" options={{ title: 'Capture' }} />
            <Drawer.Screen name="library/index" options={{ title: 'Documents' }} />
          </Drawer>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
