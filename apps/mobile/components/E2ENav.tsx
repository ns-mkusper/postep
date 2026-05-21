import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { isE2EMode } from '@postep/bridge';

export function E2ENav() {
  const isE2E = process.env.EXPO_PUBLIC_POSTEP_E2E === '1' || isE2EMode();
  if (!isE2E) {
    return null;
  }

  return (
    <View style={styles.container} testID="e2e-nav">
      <TouchableOpacity testID="e2e-nav-documents" style={styles.button} onPress={() => router.replace('/library')}>
        <Text style={styles.text}>E2E Documents</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="e2e-nav-agenda" style={styles.button} onPress={() => router.replace('/agenda')}>
        <Text style={styles.text}>E2E Agenda</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="e2e-nav-habits" style={styles.button} onPress={() => router.replace('/habits')}>
        <Text style={styles.text}>E2E Habits</Text>
      </TouchableOpacity>
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
