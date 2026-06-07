import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useBridgeConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import { loadRoamGraphForConfig } from "../../lib/roamSources";

type RoamMode = "graph" | "backlinks" | "tags";

export default function RoamScreen() {
  const config = useBridgeConfig();
  const [mode, setMode] = useState<RoamMode>("graph");

  const roamQuery = useQuery({
    queryKey: [
      "roam",
      config.roots.join(":"),
      config.roamRoots?.join(":") ?? "",
    ],
    queryFn: () =>
      config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0
        ? Promise.resolve({ nodes: [], links: [] })
        : loadRoamGraphForConfig(config),
  });

  useBridgeEvent("documentsChanged", () => roamQuery.refetch());
  useBridgeEvent("rootsChanged", () => roamQuery.refetch());

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedNodeId && roamQuery.data && roamQuery.data.nodes.length > 0) {
      setSelectedNodeId(roamQuery.data.nodes[0].id);
    }
  }, [roamQuery.data, selectedNodeId]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId || !roamQuery.data) {
      return null;
    }
    return (
      roamQuery.data.nodes.find((node) => node.id === selectedNodeId) ?? null
    );
  }, [selectedNodeId, roamQuery.data]);

  const backlinks = useMemo(() => {
    if (!selectedNode || !roamQuery.data) {
      return [];
    }
    const inbound = roamQuery.data.links.filter(
      (link) => link.target === selectedNode.id,
    );
    return inbound
      .map((link) =>
        roamQuery.data.nodes.find((node) => node.id === link.source),
      )
      .filter((node): node is NonNullable<typeof node> => Boolean(node));
  }, [selectedNode, roamQuery.data]);

  const tagGroups = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const node of roamQuery.data?.nodes ?? []) {
      for (const tag of node.tags) {
        groups[tag] = (groups[tag] ?? 0) + 1;
      }
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [roamQuery.data?.nodes]);

  const graphStats = useMemo(() => {
    const nodes = roamQuery.data?.nodes.length ?? 0;
    const links = roamQuery.data?.links.length ?? 0;
    return { nodes, links, density: nodes === 0 ? 0 : links / nodes };
  }, [roamQuery.data]);

  return (
    <View style={styles.container} testID="roam-screen">
      <Text style={styles.header}>Roam Nodes</Text>
      <View style={styles.modeRow} testID="roam-mode-row">
        {(["graph", "backlinks", "tags"] as const).map((option) => (
          <TouchableOpacity
            key={option}
            testID={`roam-mode-${option}`}
            style={[
              styles.modeButton,
              mode === option && styles.modeButtonSelected,
            ]}
            onPress={() => setMode(option)}
          >
            <Text style={styles.modeText}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        testID="roam-node-list"
        data={roamQuery.data?.nodes ?? []}
        horizontal
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.nodeList}
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`roam-node-${item.id}`}
            style={[
              styles.nodeChip,
              selectedNodeId === item.id && styles.nodeChipSelected,
            ]}
            onPress={() => setSelectedNodeId(item.id)}
          >
            <Text style={styles.nodeChipText}>{item.title}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Pick an Org-roam directory to see backlinks.
            </Text>
          </View>
        )}
      />

      {mode === "graph" && (
        <View style={styles.detailCard} testID="roam-graph-mode">
          <Text style={styles.detailTitle}>Graph overview</Text>
          <Text style={styles.backlink}>Nodes: {graphStats.nodes}</Text>
          <Text style={styles.backlink}>Links: {graphStats.links}</Text>
          <Text style={styles.backlink}>
            Density: {graphStats.density.toFixed(2)}
          </Text>
        </View>
      )}

      {mode === "backlinks" && selectedNode && (
        <View style={styles.detailCard} testID="roam-backlinks-mode">
          <Text style={styles.detailTitle}>{selectedNode.title}</Text>
          <Text style={styles.detailPath}>{selectedNode.path}</Text>
          <Text style={styles.sectionLabel}>Backlinks</Text>
          {backlinks.length === 0 && (
            <Text style={styles.emptyText}>No backlinks yet.</Text>
          )}
          {backlinks.map((node) => (
            <Text key={node.id} style={styles.backlink}>
              • {node.title}
            </Text>
          ))}
        </View>
      )}

      {mode === "tags" && (
        <View style={styles.detailCard} testID="roam-tags-mode">
          <Text style={styles.detailTitle}>Tags</Text>
          <View style={styles.tagRow}>
            {tagGroups.length === 0 && (
              <Text style={styles.emptyText}>No tags</Text>
            )}
            {tagGroups.map(([tag, count]) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>
                  {tag} · {count}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#071008",
    padding: 14,
  },
  header: {
    color: "#F2F5EC",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    marginBottom: 14,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  modeButton: {
    borderRadius: 12,
    backgroundColor: "#111A10",
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  modeButtonSelected: {
    backgroundColor: "#394A23",
    borderColor: "#66774A",
  },
  modeText: {
    color: "#F2F5EC",
    textTransform: "capitalize",
    fontWeight: "800",
    fontSize: 16,
  },
  nodeList: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  nodeChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3D4638",
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginRight: 10,
    backgroundColor: "#091108",
  },
  nodeChipSelected: {
    backgroundColor: "#1E271B",
    borderColor: "#6E814E",
  },
  nodeChipText: {
    color: "#DDE5D4",
    fontSize: 17,
    lineHeight: 23,
  },
  detailCard: {
    marginTop: 20,
    backgroundColor: "#091108",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  detailTitle: {
    color: "#F2F5EC",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
  },
  detailPath: {
    color: "#8C9486",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  sectionLabel: {
    color: "#9BA394",
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 18,
    marginBottom: 6,
    fontWeight: "800",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  tagChip: {
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: "#CDD5C5",
    fontSize: 15,
  },
  backlink: {
    color: "#DDE5D4",
    marginBottom: 6,
    fontSize: 19,
    lineHeight: 27,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "center",
  },
});
