import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useOrgConfig } from '../store/orgConfig';

export default function IndexRoute() {
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const hasHydrated = useOrgConfig((state) => state.hasHydrated);
  const hasSources = roots.length > 0 || roamRoots.length > 0;

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    const destination = hasSources ? '/library' : '/settings';
    const handle = setTimeout(() => {
      router.replace(destination);
    }, 0);
    return () => clearTimeout(handle);
  }, [hasHydrated, hasSources]);

  return (
    <View style={styles.loadingScreen} testID="postep-startup-screen">
      <ActivityIndicator color="#DDE5D4" />
      <Text style={styles.loadingText}>
        {hasHydrated ? 'Opening Postep…' : 'Loading Postep…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#071008',
    gap: 12,
  },
  loadingText: {
    color: '#DDE5D4',
    fontSize: 16,
    fontWeight: '700',
  },
});
