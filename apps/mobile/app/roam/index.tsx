import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import { useBridgeConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import { loadRoamGraphForConfig } from "../../lib/roamSources";
import {
  buildRoamExplorerView,
  type RoamNodeSummary,
  type RoamPanel,
  type RoamRelationshipFilter,
} from "../../lib/roamViewModel";

type FilterOption = {
  label: string;
  value: RoamRelationshipFilter;
};

const FILTERS: FilterOption[] = [
  { label: "All", value: "all" },
  { label: "Linked", value: "linked" },
  { label: "Unlinked", value: "unlinked" },
  { label: "Daily", value: "daily" },
];

export default function RoamScreen() {
  const config = useBridgeConfig();
  const [mode, setMode] = useState<RoamPanel>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [relationshipFilter, setRelationshipFilter] =
    useState<RoamRelationshipFilter>("all");

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

  const explorer = useMemo(
    () =>
      buildRoamExplorerView(roamQuery.data ?? { nodes: [], links: [] }, {
        selectedId: selectedNodeId,
        query,
        activeTag,
        relationshipFilter,
      }),
    [activeTag, query, relationshipFilter, roamQuery.data, selectedNodeId],
  );

  useEffect(() => {
    if (!selectedNodeId && explorer.selectedNode) {
      setSelectedNodeId(explorer.selectedNode.id);
    }
  }, [explorer.selectedNode, selectedNodeId]);

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };

  const toggleTag = (tag: string) => {
    setActiveTag((current) => (current === tag ? null : tag));
  };

  return (
    <ScrollView style={styles.container} testID="roam-screen">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>Org-roam</Text>
          <Text style={styles.header}>Knowledge Graph</Text>
        </View>
        <View style={styles.statusPill} testID="roam-source-status">
          <Text style={styles.statusText}>
            {roamQuery.isFetching ? "Refreshing" : `${explorer.summary.nodes} notes`}
          </Text>
        </View>
      </View>

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

      <View style={styles.searchCard} testID="roam-filter-panel">
        <TextInput
          testID="roam-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes, paths, tags"
          placeholderTextColor="#7D8676"
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.filterRow}>
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.value}
              testID={`roam-filter-${filter.value}`}
              style={[
                styles.filterChip,
                relationshipFilter === filter.value && styles.filterChipSelected,
              ]}
              onPress={() => setRelationshipFilter(filter.value)}
            >
              <Text style={styles.filterText}>{filter.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {(query || activeTag || relationshipFilter !== "all") && (
          <TouchableOpacity
            testID="roam-clear-filters"
            style={styles.clearButton}
            onPress={() => {
              setQuery("");
              setActiveTag(null);
              setRelationshipFilter("all");
            }}
          >
            <Text style={styles.clearText}>Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.statsGrid} testID="roam-graph-mode">
        <StatCard label="Notes" value={String(explorer.summary.nodes)} />
        <StatCard label="Links" value={String(explorer.summary.links)} />
        <StatCard label="Tags" value={String(explorer.summary.tags)} />
        <StatCard label="Isolated" value={String(explorer.summary.isolated)} />
        <StatCard label="Density" value={explorer.summary.density.toFixed(2)} />
      </View>

      <Text style={styles.sectionLabel}>Matching notes</Text>
      <FlatList
        testID="roam-node-list"
        data={explorer.filteredNodes}
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
            onPress={() => selectNode(item.id)}
          >
            <Text style={styles.nodeChipText}>{item.title}</Text>
            <Text style={styles.nodeChipMeta}>
              {item.incomingCount} in · {item.outgoingCount} out
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {explorer.emptyReason === "no-matches"
                ? "No Roam notes match these filters."
                : "Pick an Org-roam directory to see backlinks."}
            </Text>
          </View>
        )}
      />

      {explorer.selectedNode && (
        <SelectedNoteCard node={explorer.selectedNode} />
      )}

      {(mode === "graph" || mode === "backlinks") && explorer.selectedNode && (
        <View style={styles.detailCard} testID="roam-backlinks-mode">
          <RelationshipSection
            title="Backlinks"
            empty="No backlinks yet."
            nodes={explorer.backlinks}
            onSelect={selectNode}
            testID="roam-backlink-list"
          />
          <RelationshipSection
            title="Forward links"
            empty="No forward links yet."
            nodes={explorer.forwardLinks}
            onSelect={selectNode}
            testID="roam-forward-link-list"
          />
          <Text style={styles.sectionLabel}>Related notes</Text>
          {explorer.relatedNotes.length === 0 && (
            <Text style={styles.emptyTextLeft}>No related notes yet.</Text>
          )}
          {explorer.relatedNotes.map((item) => (
            <TouchableOpacity
              key={item.node.id}
              testID={`roam-related-${item.node.id}`}
              style={styles.relationshipItem}
              onPress={() => selectNode(item.node.id)}
            >
              <Text style={styles.relationshipTitle}>{item.node.title}</Text>
              <Text style={styles.relationshipMeta}>{item.reasons.join(" · ")}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {(mode === "graph" || mode === "tags") && (
        <View style={styles.detailCard} testID="roam-tags-mode">
          <Text style={styles.detailTitle}>Topics</Text>
          <View style={styles.tagRow}>
            {explorer.tagGroups.length === 0 && (
              <Text style={styles.emptyTextLeft}>No tags</Text>
            )}
            {explorer.tagGroups.map((group) => (
              <TouchableOpacity
                key={group.tag}
                testID={`roam-tag-${group.tag}`}
                style={[
                  styles.tagChip,
                  activeTag === group.tag && styles.tagChipSelected,
                ]}
                onPress={() => toggleTag(group.tag)}
              >
                <Text style={styles.tagText}>
                  {group.tag} · {group.count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {mode === "graph" && (
        <View style={styles.detailCard} testID="roam-daily-mode">
          <Text style={styles.detailTitle}>Daily / recent</Text>
          {explorer.dailyNotes.length === 0 && (
            <Text style={styles.emptyTextLeft}>No daily notes detected.</Text>
          )}
          {explorer.dailyNotes.slice(0, 8).map((node) => (
            <TouchableOpacity
              key={node.id}
              testID={`roam-daily-${node.id}`}
              style={styles.relationshipItem}
              onPress={() => selectNode(node.id)}
            >
              <Text style={styles.relationshipTitle}>{node.title}</Text>
              <Text style={styles.relationshipMeta}>{node.dailyDate}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SelectedNoteCard({ node }: { node: RoamNodeSummary }) {
  return (
    <View style={styles.selectedCard} testID="roam-selected-note">
      <Text style={styles.detailTitle}>{node.title}</Text>
      <Text style={styles.detailPath}>{node.path}</Text>
      <View style={styles.noteMetaRow}>
        <Text style={styles.noteMeta}>{node.incomingCount} backlinks</Text>
        <Text style={styles.noteMeta}>{node.outgoingCount} forward</Text>
        {node.dailyDate && <Text style={styles.noteMeta}>{node.dailyDate}</Text>}
      </View>
      <View style={styles.tagRow}>
        {node.tags.map((tag) => (
          <View key={tag} style={styles.smallTagChip}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RelationshipSection({
  title,
  empty,
  nodes,
  onSelect,
  testID,
}: {
  title: string;
  empty: string;
  nodes: RoamNodeSummary[];
  onSelect: (nodeId: string) => void;
  testID: string;
}) {
  return (
    <View testID={testID}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {nodes.length === 0 && <Text style={styles.emptyTextLeft}>{empty}</Text>}
      {nodes.map((node) => (
        <TouchableOpacity
          key={node.id}
          testID={`roam-link-${node.id}`}
          style={styles.relationshipItem}
          onPress={() => onSelect(node.id)}
        >
          <Text style={styles.relationshipTitle}>• {node.title}</Text>
          <Text style={styles.relationshipMeta}>{node.path}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#071008",
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  kicker: {
    color: "#9BA394",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  header: {
    color: "#F2F5EC",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3D4638",
    backgroundColor: "#111A10",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    color: "#DDE5D4",
    fontSize: 13,
    fontWeight: "800",
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
  searchCard: {
    backgroundColor: "#091108",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#3D4638",
    marginBottom: 14,
  },
  searchInput: {
    color: "#F2F5EC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#303B2D",
    backgroundColor: "#071008",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#303B2D",
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "#111A10",
  },
  filterChipSelected: {
    backgroundColor: "#394A23",
    borderColor: "#66774A",
  },
  filterText: {
    color: "#DDE5D4",
    fontWeight: "800",
    fontSize: 13,
  },
  clearButton: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  clearText: {
    color: "#BDD18A",
    fontWeight: "800",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  statCard: {
    minWidth: 96,
    flexGrow: 1,
    backgroundColor: "#091108",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  statValue: {
    color: "#F2F5EC",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  statLabel: {
    color: "#9BA394",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
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
    minWidth: 150,
  },
  nodeChipSelected: {
    backgroundColor: "#1E271B",
    borderColor: "#6E814E",
  },
  nodeChipText: {
    color: "#DDE5D4",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
  },
  nodeChipMeta: {
    color: "#9BA394",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  selectedCard: {
    marginTop: 12,
    backgroundColor: "#14200F",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#66774A",
  },
  detailCard: {
    marginTop: 14,
    backgroundColor: "#091108",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  detailTitle: {
    color: "#F2F5EC",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  detailPath: {
    color: "#8C9486",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  noteMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  noteMeta: {
    color: "#DDE5D4",
    backgroundColor: "#223018",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    fontSize: 13,
    fontWeight: "800",
  },
  sectionLabel: {
    color: "#9BA394",
    fontSize: 13,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#3D4638",
  },
  tagChipSelected: {
    backgroundColor: "#394A23",
    borderColor: "#BDD18A",
  },
  smallTagChip: {
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  tagText: {
    color: "#CDD5C5",
    fontSize: 15,
    fontWeight: "700",
  },
  relationshipItem: {
    borderTopWidth: 1,
    borderTopColor: "#1F2A1C",
    paddingVertical: 10,
  },
  relationshipTitle: {
    color: "#DDE5D4",
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
  },
  relationshipMeta: {
    color: "#8C9486",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  empty: {
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    minWidth: 260,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "center",
  },
  emptyTextLeft: {
    color: "#8C9486",
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 6,
  },
});
