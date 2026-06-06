import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { appendCaptureEntryAsync } from "@postep/bridge";
import { useBridgeConfig } from "../../store/orgConfig";

export default function CaptureScreen() {
  const queryClient = useQueryClient();
  const config = useBridgeConfig();
  const [content, setContent] = useState("* TODO ");
  const [targetPath, setTargetPath] = useState("inbox.org");
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit() {
    if (config.roots.length === 0) {
      setStatus("Please add an Org root first.");
      return;
    }
    try {
      const snapshot = await appendCaptureEntryAsync({
        roots: config.roots,
        roamRoots: config.roamRoots,
        targetPath,
        content,
      });
      queryClient.setQueryData(
        ["agenda", config.roots.join(":"), config.roamRoots?.join(":") ?? ""],
        snapshot,
      );
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "documents",
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "document",
      });
      setContent("* TODO ");
      setStatus(`Captured to ${targetPath}`);
    } catch (error) {
      setStatus("Failed: " + (error as Error).message);
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
    backgroundColor: "#071008",
    padding: 18,
  },
  label: {
    color: "#A6AEA0",
    marginBottom: 7,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#091108",
    color: "#F2F5EC",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: "#3D4638",
    fontSize: 20,
    lineHeight: 28,
  },
  textarea: {
    minHeight: 170,
    textAlignVertical: "top",
  },
  button: {
    backgroundColor: "#4D5F31",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 18,
  },
  status: {
    marginTop: 16,
    color: "#9BA394",
    fontSize: 17,
    lineHeight: 24,
  },
});
