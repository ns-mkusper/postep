import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { loadRoamGraph } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';

type RoamMode = 'graph' | 'backlinks' | 'tags';

export default function RoamScreen() {
  const config = useBridgeConfig();
  const [mode, setMode] = useState<RoamMode>('graph');

  const roamQuery = useQuery({
    queryKey: ['roam', config.roots.join(':'), config.roamRoots?.join(':') ?? ''],
    queryFn: () => Promise.resolve(loadRoamGraph(config))
  });

  useBridgeEvent('documentsChanged', () => roamQuery.refetch());
  useBridgeEvent('rootsChanged', () => roamQuery.refetch());

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
    return roamQuery.data.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, roamQuery.data]);

  const backlinks = useMemo(() => {
    if (!selectedNode || !roamQuery.data) {
      return [];
    }
    const inbound = roamQuery.data.links.filter((link) => link.target === selectedNode.id);
    return inbound
      .map((link) => roamQuery.data.nodes.find((node) => node.id === link.source))
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
        {(['graph', 'backlinks', 'tags'] as const).map((option) => (
          <TouchableOpacity
            key={option}
            testID={`roam-mode-${option}`}
            style={[styles.modeButton, mode === option && styles.modeButtonSelected]}
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
            style={[styles.nodeChip, selectedNodeId === item.id && styles.nodeChipSelected]}
            onPress={() => setSelectedNodeId(item.id)}
          >
            <Text style={styles.nodeChipText}>{item.title}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Pick an Org-roam directory to see backlinks.</Text>
          </View>
        )}
      />

      {mode === 'graph' && (
        <View style={styles.detailCard} testID="roam-graph-mode">
          <Text style={styles.detailTitle}>Graph overview</Text>
          <Text style={styles.backlink}>Nodes: {graphStats.nodes}</Text>
          <Text style={styles.backlink}>Links: {graphStats.links}</Text>
          <Text style={styles.backlink}>Density: {graphStats.density.toFixed(2)}</Text>
        </View>
      )}

      {mode === 'backlinks' && selectedNode && (
        <View style={styles.detailCard} testID="roam-backlinks-mode">
          <Text style={styles.detailTitle}>{selectedNode.title}</Text>
          <Text style={styles.detailPath}>{selectedNode.path}</Text>
          <Text style={styles.sectionLabel}>Backlinks</Text>
          {backlinks.length === 0 && <Text style={styles.emptyText}>No backlinks yet.</Text>}
          {backlinks.map((node) => (
            <Text key={node.id} style={styles.backlink}>
              • {node.title}
            </Text>
          ))}
        </View>
      )}

      {mode === 'tags' && (
        <View style={styles.detailCard} testID="roam-tags-mode">
          <Text style={styles.detailTitle}>Tags</Text>
          <View style={styles.tagRow}>
            {tagGroups.length === 0 && <Text style={styles.emptyText}>No tags</Text>}
            {tagGroups.map(([tag, count]) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag} · {count}</Text>
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
    backgroundColor: '#08090B',
    padding: 16
  },
  header: {
    color: '#F5F7FB',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10
  },
  modeButton: {
    borderRadius: 10,
    backgroundColor: '#151923',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  modeButtonSelected: {
    backgroundColor: '#34407A'
  },
  modeText: {
    color: '#F4F7FE',
    textTransform: 'capitalize',
    fontWeight: '700'
  },
  nodeList: {
    paddingVertical: 8,
    paddingRight: 16
  },
  nodeChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E232F',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 12
  },
  nodeChipSelected: {
    backgroundColor: '#1E232F',
    borderColor: '#4C6EF5'
  },
  nodeChipText: {
    color: '#D9DEEB'
  },
  detailCard: {
    marginTop: 24,
    backgroundColor: '#1E212B',
    borderRadius: 16,
    padding: 16
  },
  detailTitle: {
    color: '#F6F8FC',
    fontSize: 20,
    fontWeight: '700'
  },
  detailPath: {
    color: '#81889C',
    fontSize: 12,
    marginTop: 4
  },
  sectionLabel: {
    color: '#7F88A3',
    fontSize: 12,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  tagChip: {
    backgroundColor: '#2A2F3D',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 8
  },
  tagText: {
    color: '#C7CEDE'
  },
  backlink: {
    color: '#D9DEEB',
    marginBottom: 4
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  emptyText: {
    color: '#6A7084'
  }
});
