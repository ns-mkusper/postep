import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { isE2EMode } from '@postep/bridge';

const navItems = [
  { href: '/library', label: 'Documents', testID: 'e2e-nav-documents' },
  { href: '/agenda', label: 'Agenda', testID: 'e2e-nav-agenda' },
  { href: '/habits', label: 'Habits', testID: 'e2e-nav-habits' },
  { href: '/roam', label: 'Roam', testID: 'e2e-nav-roam' }
] as const;

export function E2ENav() {
  const isE2E = process.env.EXPO_PUBLIC_POSTEP_E2E === '1' || isE2EMode();
  if (!isE2E) {
    return null;
  }

  return (
    <View style={styles.container} testID="e2e-nav">
      {navItems.map((item) => (
        <Link key={item.href} href={item.href} asChild>
          <Pressable testID={item.testID} style={styles.button}>
            <Text style={styles.text}>{item.label}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0A0D14',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.18)'
  },
  button: {
    flex: 1,
    backgroundColor: '#34407A',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center'
  },
  text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  }
});
