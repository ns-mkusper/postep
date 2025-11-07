import React, { useState } from 'react';
import { View, TextInput, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { appendCaptureEntry } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';

export default function CaptureScreen() {
  const queryClient = useQueryClient();
  const config = useBridgeConfig();
  const [content, setContent] = useState('* TODO ');
  const [targetPath, setTargetPath] = useState('inbox.org');
  const [status, setStatus] = useState<string | null>(null);

  function handleSubmit() {
    if (config.roots.length === 0) {
      setStatus('Please add an Org root first.');
      return;
    }
    try {
      const snapshot = appendCaptureEntry({
        roots: config.roots,
        roamRoots: config.roamRoots,
        targetPath,
        content
      });
      queryClient.setQueryData(
        ['agenda', config.roots.join(':'), config.roamRoots?.join(':') ?? ''],
        snapshot
      );
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'documents' });
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'document' });
      setContent('* TODO ');
      setStatus(`Captured to ${targetPath}`);
    } catch (error) {
      setStatus('Failed: ' + (error as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Target File</Text>
      <TextInput
        style={styles.input}
        value={targetPath}
        onChangeText={setTargetPath}
        placeholder="inbox.org"
        placeholderTextColor="#6B6F7C"
      />
      <Text style={styles.label}>Capture Content</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        multiline
        value={content}
        onChangeText={setContent}
      />
      <TouchableOpacity style={styles.button} onPress={handleSubmit}>
        <Text style={styles.buttonText}>Save Capture</Text>
      </TouchableOpacity>
      {status && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0C0F',
    padding: 20
  },
  label: {
    color: '#AEB4C6',
    marginBottom: 6,
    fontSize: 12
  },
  input: {
    backgroundColor: '#181B23',
    color: '#F5F6FA',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16
  },
  textarea: {
    minHeight: 140,
    textAlignVertical: 'top'
  },
  button: {
    backgroundColor: '#4C6EF5',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600'
  },
  status: {
    marginTop: 16,
    color: '#7B849E'
  }
});
