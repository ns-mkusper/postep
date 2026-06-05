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
  const dark = scheme === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
          <StatusBar style="light" />
          <Drawer
            initialRouteName="library/index"
            screenOptions={{
              headerTintColor: '#F2F5EC',
              headerStyle: { backgroundColor: '#071008' },
              headerTitleStyle: { fontWeight: '800', fontSize: 22 },
              drawerStyle: { backgroundColor: '#091108' },
              drawerActiveTintColor: '#F2F5EC',
              drawerInactiveTintColor: '#A6AEA0',
              drawerActiveBackgroundColor: '#1E271B',
              sceneContainerStyle: { backgroundColor: '#071008' }
            }}
          >
            <Drawer.Screen name="library/index" options={{ title: 'Notes', headerShown: false }} />
            <Drawer.Screen name="capture/index" options={{ title: 'Capture' }} />
            <Drawer.Screen name="agenda/index" options={{ title: 'Agenda' }} />
            <Drawer.Screen name="habits/index" options={{ title: 'Habits' }} />
            <Drawer.Screen name="roam/index" options={{ title: 'Roam' }} />
            <Drawer.Screen name="settings/index" options={{ title: 'Org Settings' }} />
          </Drawer>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
