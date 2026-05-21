import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { isE2EMode } from '@postep/bridge';

const isE2E = isE2EMode();

export function E2ENav() {
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
