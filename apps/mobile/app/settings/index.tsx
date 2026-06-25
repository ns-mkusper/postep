import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useOrgConfig } from "../../store/orgConfig";
import { clearDocumentSourceCache, dedupeSourceList, normalizeSourceIdentity } from "../../lib/documentSources";
import {
  clearWarmOrgCache,
  getWarmOrgCacheStatus,
  refreshWarmOrgWorkspace,
  type WarmOrgCacheMetrics,
  type WarmOrgCacheStatus,
} from "../../lib/orgWarmCache";

const ANDROID_STATUS_BAR_FALLBACK = 58;

function topSystemInset(insetTop: number): number {
  if (Platform.OS !== "android") {
    return insetTop;
  }
  return Math.max(
    insetTop,
    StatusBar.currentHeight ?? 0,
    ANDROID_STATUS_BAR_FALLBACK,
  );
}

function pickerErrorStatus(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message)) {
    return "Picker cancelled";
  }
  return `Picker failed: ${message}`;
}

function formatListingWarning(errors: Array<{ message: string }>): string {
  if (errors.length === 0) {
    return "";
  }
  const first = errors[0]?.message ? `: ${errors[0].message}` : "";
  return ` · ${errors.length} skipped${first}`;
}

function formatCacheAge(status: WarmOrgCacheStatus | null): string {
  if (!status?.exists || !status.lastIndexedAt) {
    return "Never indexed";
  }
  const ageMs = Math.max(0, Date.now() - status.lastIndexedAt);
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) {
    return "Last indexed just now";
  }
  if (minutes < 60) {
    return `Last indexed ${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Last indexed ${hours} hr ago`;
  }
  return `Last indexed ${Math.floor(hours / 24)} days ago`;
}

function formatCacheMetrics(metrics: WarmOrgCacheMetrics): string {
  return `${metrics.documents} docs · ${metrics.changedDocuments} changed · ${metrics.unchangedDocuments} unchanged · ${metrics.elapsedMs.toFixed(0)}ms`;
}

type FileListingSummary = {
  kind: "org" | "roam";
  root: string;
  names: string[];
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const configKey = useMemo(() => JSON.stringify({ roots, roamRoots }), [roots, roamRoots]);
  const config = useMemo(() => ({
    roots,
    ...(roamRoots.length > 0 ? { roamRoots } : {}),
  }), [configKey]);
  const addRoot = useOrgConfig((state) => state.addRoot);
  const removeRoot = useOrgConfig((state) => state.removeRoot);
  const addRoamRoot = useOrgConfig((state) => state.addRoamRoot);
  const removeRoamRoot = useOrgConfig((state) => state.removeRoamRoot);
  const [newRoot, setNewRoot] = useState("");
  const [newRoamRoot, setNewRoamRoot] = useState("");
  const [pickerStatus, setPickerStatus] = useState<string | null>(null);
  const [listingSummaries, setListingSummaries] = useState<FileListingSummary[]>([]);
  const [loadingSource, setLoadingSource] = useState<"org" | "roam" | null>(null);
  const [cacheStatus, setCacheStatus] = useState<WarmOrgCacheStatus | null>(null);
  const [cacheAction, setCacheAction] = useState<"refresh" | "clear" | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const isAndroid = Platform.OS === "android";
  const contentPaddingTop = topSystemInset(insets.top) + 18;

  useEffect(() => {
    let cancelled = false;
    getWarmOrgCacheStatus(config)
      .then((status) => {
        if (!cancelled) {
          setCacheStatus(status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCacheMessage(`Cache status failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const handleRefreshCache = async () => {
    if (cacheAction) {
      return;
    }
    setCacheAction("refresh");
    setCacheMessage("Refreshing workspace cache…");
    try {
      const metrics = await refreshWarmOrgWorkspace(queryClient, config);
      setCacheStatus(await getWarmOrgCacheStatus(config));
      setCacheMessage(`Refresh complete · ${formatCacheMetrics(metrics)}`);
    } catch (error) {
      setCacheMessage(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCacheAction(null);
    }
  };

  const handleClearCache = async () => {
    if (cacheAction) {
      return;
    }
    setCacheAction("clear");
    setCacheMessage("Clearing local cache…");
    try {
      await clearWarmOrgCache(queryClient);
      clearDocumentSourceCache();
      setCacheStatus(await getWarmOrgCacheStatus(config));
      setCacheMessage("Local cache cleared");
    } catch (error) {
      setCacheMessage(`Clear failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCacheAction(null);
    }
  };

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
    if (!isAndroid || loadingSource) {
      return;
    }
    setLoadingSource("org");
    setPickerStatus("Waiting for Android folder permission…");
    try {
      const { requestOrgDirectory, listOrgFilesRecursively } =
        await import("@postep/bridge/platform/android/saf");
      const handle = await requestOrgDirectory();
      setPickerStatus("Loading source…");
      addRoot(handle.uri);
      const listing = await listOrgFilesRecursively(handle.uri);
      const names = listing.files.map((file) => file.name);
      console.warn("Postep SAF org files", names);
      setListingSummaries((summaries) => [
        { kind: "org", root: handle.uri, names },
        ...summaries.filter((summary) => summary.kind !== "org"),
      ]);
      const warning = formatListingWarning(listing.errors);
      setPickerStatus(`Added source · ${listing.entries.length} org files found${warning}`);
    } catch (error) {
      setPickerStatus(pickerErrorStatus(error));
      console.warn("SAF picker failed", error);
    } finally {
      setLoadingSource(null);
    }
  };

  const handlePickRoamRoot = async () => {
    if (!isAndroid || loadingSource) {
      return;
    }
    setLoadingSource("roam");
    setPickerStatus("Waiting for Android folder permission…");
    try {
      const { requestOrgDirectory, listOrgFilesRecursively } =
        await import("@postep/bridge/platform/android/saf");
      const handle = await requestOrgDirectory();
      setPickerStatus("Loading roam source…");
      addRoamRoot(handle.uri);
      const listing = await listOrgFilesRecursively(handle.uri);
      const names = listing.files.map((file) => file.name);
      console.warn("Postep SAF org-roam files", names);
      setListingSummaries((summaries) => [
        { kind: "roam", root: handle.uri, names },
        ...summaries.filter((summary) => summary.kind !== "roam"),
      ]);
      const warning = formatListingWarning(listing.errors);
      setPickerStatus(`Added roam source · ${listing.entries.length} org files found${warning}`);
    } catch (error) {
      setPickerStatus(pickerErrorStatus(error));
      console.warn("SAF picker failed", error);
    } finally {
      setLoadingSource(null);
    }
  };

  const handleVerifyRoots = async () => {
    if (!isAndroid || loadingSource) {
      return;
    }
    const orgRootIdentities = new Set(
      dedupeSourceList(roots).map(normalizeSourceIdentity),
    );
    const configuredRoots: Array<{ kind: "org" | "roam"; root: string }> = [
      ...dedupeSourceList(roots).map((root) => ({ kind: "org" as const, root })),
      ...dedupeSourceList(roamRoots)
        .filter((root) => !orgRootIdentities.has(normalizeSourceIdentity(root)))
        .map((root) => ({ kind: "roam" as const, root })),
    ].filter((configured) => configured.root.startsWith("content://"));
    if (configuredRoots.length === 0) {
      setPickerStatus("No configured Android SAF folders to verify.");
      setListingSummaries([]);
      return;
    }
    setLoadingSource("org");
    setPickerStatus("Verifying configured folders…");
    try {
      const { listOrgFilesRecursively } =
        await import("@postep/bridge/platform/android/saf");
      const summaries: FileListingSummary[] = [];
      for (const configured of configuredRoots) {
        const listing = await listOrgFilesRecursively(configured.root);
        const names = listing.files.map((file) => file.name);
        console.warn(
          configured.kind === "org"
            ? "Postep SAF org files"
            : "Postep SAF org-roam files",
          names,
        );
        summaries.push({ kind: configured.kind, root: configured.root, names });
      }
      setListingSummaries(summaries);
      const total = summaries.reduce((sum, summary) => sum + summary.names.length, 0);
      setPickerStatus(`Verified ${configuredRoots.length} folders · ${total} org files found`);
    } catch (error) {
      setPickerStatus(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn("SAF verification failed", error);
    } finally {
      setLoadingSource(null);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: contentPaddingTop }]}
        testID="settings-screen"
      >
      <View style={styles.navBar}>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.replace("/library")}
          testID="settings-back-to-library"
          accessibilityLabel="Back to notes"
        >
          <Text style={styles.navIcon}>‹</Text>
          <Text style={styles.navText}>Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.replace("/")}
          testID="settings-home"
          accessibilityLabel="Go to home"
        >
          <Text style={styles.navText}>Home</Text>
        </TouchableOpacity>
      </View>
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
          style={[styles.pickerButton, loadingSource && styles.disabledButton]}
          onPress={handlePickOrgRoot}
          disabled={Boolean(loadingSource)}
        >
          {loadingSource === "org" ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#DDE5D4" />
              <Text style={styles.pickerText}>Loading source…</Text>
            </View>
          ) : (
            <Text style={styles.pickerText}>Pick via Android SAF</Text>
          )}
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
          style={[styles.pickerButton, loadingSource && styles.disabledButton]}
          onPress={handlePickRoamRoot}
          disabled={Boolean(loadingSource)}
        >
          {loadingSource === "roam" ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#DDE5D4" />
              <Text style={styles.pickerText}>Loading source…</Text>
            </View>
          ) : (
            <Text style={styles.pickerText}>Pick Roam Directory</Text>
          )}
        </TouchableOpacity>
      )}
      {pickerStatus && <Text style={styles.pickerStatus}>{pickerStatus}</Text>}
      {isAndroid && (
        <TouchableOpacity
          style={[styles.verifyButton, loadingSource && styles.disabledButton]}
          onPress={handleVerifyRoots}
          disabled={Boolean(loadingSource)}
        >
          <Text style={styles.pickerText}>Verify Configured Folders</Text>
        </TouchableOpacity>
      )}
      <Text style={[styles.sectionHeading, { marginTop: 28 }]}>Cache controls</Text>
      <View style={styles.cachePanel}>
        <Text style={styles.cacheStatus} testID="cache-last-indexed">
          {formatCacheAge(cacheStatus)}
        </Text>
        <Text style={styles.cacheDetail}>
          {cacheStatus?.exists
            ? `${cacheStatus.documents} docs · ${cacheStatus.payloads} payloads · ${cacheStatus.agendaItems} agenda · ${cacheStatus.roamNodes} roam`
            : "No local org cache yet"}
        </Text>
        <View style={styles.cacheButtonRow}>
          <TouchableOpacity
            style={[styles.cacheButton, cacheAction && styles.disabledButton]}
            onPress={handleRefreshCache}
            disabled={Boolean(cacheAction)}
            testID="cache-refresh-workspace"
          >
            <Text style={styles.pickerText}>
              {cacheAction === "refresh" ? "Refreshing…" : "Refresh workspace"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.cacheButton, styles.cacheDangerButton, cacheAction && styles.disabledButton]}
            onPress={handleClearCache}
            disabled={Boolean(cacheAction)}
            testID="cache-clear-local-cache"
          >
            <Text style={styles.pickerText}>
              {cacheAction === "clear" ? "Clearing…" : "Clear local cache"}
            </Text>
          </TouchableOpacity>
        </View>
        {cacheMessage && <Text style={styles.cacheDetail}>{cacheMessage}</Text>}
      </View>

      {listingSummaries.map((summary) => (
        <View key={summary.kind} style={styles.fileListPanel}>
          <Text style={styles.fileListTitle}>
            {summary.kind === "org" ? "Org files" : "Org-roam files"} · {summary.names.length}
          </Text>
          <Text style={styles.fileListRoot} numberOfLines={2}>
            {summary.root}
          </Text>
          {summary.names.map((name) => (
            <Text key={`${summary.kind}:${name}`} style={styles.fileListItem}>
              {name}
            </Text>
          ))}
        </View>
      ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071008" },
  scroll: { flex: 1 },
  content: { padding: 18, paddingBottom: 48 },
  navBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  navButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#111A10",
    borderWidth: 1,
    borderColor: "#303B2D",
    flexDirection: "row",
    alignItems: "center",
  },
  navIcon: {
    color: "#F2F5EC",
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "800",
    marginRight: 4,
  },
  navText: {
    color: "#F2F5EC",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
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
  disabledButton: { opacity: 0.62 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerStatus: {
    marginTop: 14,
    color: "#9BA394",
    fontSize: 16,
    lineHeight: 22,
  },
  verifyButton: {
    marginTop: 12,
    backgroundColor: "#182116",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3D4638",
  },
  cachePanel: {
    borderWidth: 1,
    borderColor: "#303B2D",
    backgroundColor: "#0B130A",
    borderRadius: 12,
    padding: 14,
  },
  cacheStatus: {
    color: "#F2F5EC",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
    marginBottom: 4,
  },
  cacheDetail: {
    color: "#9BA394",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  cacheButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  cacheButton: {
    flex: 1,
    backgroundColor: "#182116",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3D4638",
  },
  cacheDangerButton: {
    backgroundColor: "#211615",
    borderColor: "#513832",
  },
  fileListPanel: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#303B2D",
    backgroundColor: "#0B130A",
    borderRadius: 8,
    padding: 12,
  },
  fileListTitle: {
    color: "#F2F5EC",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    marginBottom: 4,
  },
  fileListRoot: {
    color: "#7F8878",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
  },
  fileListItem: {
    color: "#B9C0B2",
    fontSize: 13,
    lineHeight: 18,
  },
});
