import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useOrgConfig } from "../../store/orgConfig";

export default function SettingsScreen() {
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const addRoot = useOrgConfig((state) => state.addRoot);
  const removeRoot = useOrgConfig((state) => state.removeRoot);
  const addRoamRoot = useOrgConfig((state) => state.addRoamRoot);
  const removeRoamRoot = useOrgConfig((state) => state.removeRoamRoot);
  const [newRoot, setNewRoot] = useState("");
  const [newRoamRoot, setNewRoamRoot] = useState("");
  const [pickerStatus, setPickerStatus] = useState<string | null>(null);
  const isAndroid = Platform.OS === "android";

  const handleAddRoot = () => {
    if (!newRoot.trim()) {
      return;
    }
    addRoot(newRoot.trim());
    setNewRoot("");
  };

  const handleAddRoamRoot = () => {
    if (!newRoamRoot.trim()) {
      return;
    }
    addRoamRoot(newRoamRoot.trim());
    setNewRoamRoot("");
  };

  const handlePickOrgRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } =
        await import("@postep/bridge/platform/android/saf");
      const handle = await requestOrgDirectory();
      addRoot(handle.uri);
      setPickerStatus(`Added ${handle.uri}`);
    } catch (error) {
      setPickerStatus("Picker cancelled or failed");
      console.warn("SAF picker failed", error);
    }
  };

  const handlePickRoamRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } =
        await import("@postep/bridge/platform/android/saf");
      const handle = await requestOrgDirectory();
      addRoamRoot(handle.uri);
      setPickerStatus(`Added roam ${handle.uri}`);
    } catch (error) {
      setPickerStatus("Picker cancelled or failed");
      console.warn("SAF picker failed", error);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="settings-screen"
    >
      <Text style={styles.title}>Org settings</Text>
      <Text style={styles.description}>
        Choose the local folders Postep should parse for notes, agenda items,
        habits, and org-roam links.
      </Text>

      <Text style={styles.sectionHeading}>Org Roots</Text>
      <View style={styles.chipRow}>
        {roots.map((root) => (
          <View key={root} style={styles.rootChip}>
            <Text style={styles.rootChipText}>{root}</Text>
            <TouchableOpacity
              style={styles.removeChipBtn}
              onPress={() => removeRoot(root)}
            >
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
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={handlePickOrgRoot}
        >
          <Text style={styles.pickerText}>Pick via Android SAF</Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.sectionHeading, { marginTop: 28 }]}>
        Org-roam Roots
      </Text>
      <View style={styles.chipRow}>
        {roamRoots.map((root) => (
          <View key={root} style={styles.rootChip}>
            <Text style={styles.rootChipText}>{root}</Text>
            <TouchableOpacity
              style={styles.removeChipBtn}
              onPress={() => removeRoamRoot(root)}
            >
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
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={handlePickRoamRoot}
        >
          <Text style={styles.pickerText}>Pick Roam Directory</Text>
        </TouchableOpacity>
      )}
      {pickerStatus && <Text style={styles.pickerStatus}>{pickerStatus}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071008" },
  content: { padding: 18, paddingBottom: 48 },
  title: {
    color: "#F2F5EC",
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "800",
    marginBottom: 8,
  },
  description: {
    color: "#A6AEA0",
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 28,
  },
  sectionHeading: {
    color: "#CDD5C5",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap" },
  rootChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#091108",
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  rootChipText: {
    color: "#E4EADF",
    marginRight: 8,
    fontSize: 16,
    lineHeight: 22,
  },
  removeChipBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#1E271B",
    alignItems: "center",
    justifyContent: "center",
  },
  removeChipText: {
    color: "#F0C0B0",
    fontWeight: "800",
    fontSize: 18,
    lineHeight: 22,
  },
  inputRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  pathInput: {
    flex: 1,
    backgroundColor: "#091108",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#F2F5EC",
    borderWidth: 1.5,
    borderColor: "#3D4638",
    fontSize: 17,
    lineHeight: 24,
  },
  addButton: {
    backgroundColor: "#4D5F31",
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 14,
    marginLeft: 10,
  },
  addButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  pickerButton: {
    marginTop: 10,
    backgroundColor: "#111A10",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  pickerText: { color: "#DDE5D4", fontWeight: "800", fontSize: 16 },
  pickerStatus: {
    marginTop: 14,
    color: "#9BA394",
    fontSize: 16,
    lineHeight: 22,
  },
});
