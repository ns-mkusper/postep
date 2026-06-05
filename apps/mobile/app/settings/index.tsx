import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useOrgConfig } from '../../store/orgConfig';

export default function SettingsScreen() {
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const addRoot = useOrgConfig((state) => state.addRoot);
  const removeRoot = useOrgConfig((state) => state.removeRoot);
  const addRoamRoot = useOrgConfig((state) => state.addRoamRoot);
  const removeRoamRoot = useOrgConfig((state) => state.removeRoamRoot);
  const [newRoot, setNewRoot] = useState('');
  const [newRoamRoot, setNewRoamRoot] = useState('');
  const [pickerStatus, setPickerStatus] = useState<string | null>(null);
  const isAndroid = Platform.OS === 'android';

  const handleAddRoot = () => {
    if (!newRoot.trim()) {
      return;
    }
    addRoot(newRoot.trim());
    setNewRoot('');
  };

  const handleAddRoamRoot = () => {
    if (!newRoamRoot.trim()) {
      return;
    }
    addRoamRoot(newRoamRoot.trim());
    setNewRoamRoot('');
  };

  const handlePickOrgRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } = await import('@postep/bridge/platform/android/saf');
      const handle = await requestOrgDirectory();
      addRoot(handle.uri);
      setPickerStatus(`Added ${handle.uri}`);
    } catch (error) {
      setPickerStatus('Picker cancelled or failed');
      console.warn('SAF picker failed', error);
    }
  };

  const handlePickRoamRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } = await import('@postep/bridge/platform/android/saf');
      const handle = await requestOrgDirectory();
      addRoamRoot(handle.uri);
      setPickerStatus(`Added roam ${handle.uri}`);
    } catch (error) {
      setPickerStatus('Picker cancelled or failed');
      console.warn('SAF picker failed', error);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="settings-screen">
      <Text style={styles.title}>Org settings</Text>
      <Text style={styles.description}>Choose the local folders Postep should parse for notes, agenda items, habits, and org-roam links.</Text>

      <Text style={styles.sectionHeading}>Org Roots</Text>
      <View style={styles.chipRow}>
        {roots.map((root) => (
          <View key={root} style={styles.rootChip}>
            <Text style={styles.rootChipText}>{root}</Text>
            <TouchableOpacity style={styles.removeChipBtn} onPress={() => removeRoot(root)}>
              <Text style={styles.removeChipText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.pathInput}
          value={newRoot}
          onChangeText={setNewRoot}
          placeholder="/storage/emulated/0/Documents/org"
          placeholderTextColor="#686D7A"
        />
        <TouchableOpacity style={styles.addButton} onPress={handleAddRoot}>
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {isAndroid && (
        <TouchableOpacity style={styles.pickerButton} onPress={handlePickOrgRoot}>
          <Text style={styles.pickerText}>Pick via Android SAF</Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.sectionHeading, { marginTop: 28 }]}>Org-roam Roots</Text>
      <View style={styles.chipRow}>
        {roamRoots.map((root) => (
          <View key={root} style={styles.rootChip}>
            <Text style={styles.rootChipText}>{root}</Text>
            <TouchableOpacity style={styles.removeChipBtn} onPress={() => removeRoamRoot(root)}>
              <Text style={styles.removeChipText}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.pathInput}
          value={newRoamRoot}
          onChangeText={setNewRoamRoot}
          placeholder="/storage/emulated/0/Documents/org-roam"
          placeholderTextColor="#686D7A"
        />
        <TouchableOpacity style={styles.addButton} onPress={handleAddRoamRoot}>
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {isAndroid && (
        <TouchableOpacity style={styles.pickerButton} onPress={handlePickRoamRoot}>
          <Text style={styles.pickerText}>Pick Roam Directory</Text>
        </TouchableOpacity>
      )}
      {pickerStatus && <Text style={styles.pickerStatus}>{pickerStatus}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111217' },
  content: { padding: 22, paddingBottom: 48 },
  title: { color: '#F2F4FC', fontSize: 30, fontWeight: '800', marginBottom: 8 },
  description: { color: '#9CA1B2', fontSize: 15, lineHeight: 22, marginBottom: 28 },
  sectionHeading: { color: '#C8CBD6', fontSize: 15, fontWeight: '800', marginBottom: 10, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  rootChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#20232B',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3F434D'
  },
  rootChipText: { color: '#E4E7F0', marginRight: 8 },
  removeChipBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#343843', alignItems: 'center', justifyContent: 'center' },
  removeChipText: { color: '#FCA5A5', fontWeight: '800' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  pathInput: { flex: 1, backgroundColor: '#20232B', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: '#EEF1FB', borderWidth: 1, borderColor: '#3F434D' },
  addButton: { backgroundColor: '#B8C6F4', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, marginLeft: 10 },
  addButtonText: { color: '#202234', fontWeight: '800' },
  pickerButton: { marginTop: 10, backgroundColor: '#252832', paddingVertical: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3F434D' },
  pickerText: { color: '#D6DAE8', fontWeight: '700' },
  pickerStatus: { marginTop: 14, color: '#9CA1B2' }
});
