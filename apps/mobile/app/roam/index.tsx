import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { loadRoamGraph } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';

export default function RoamScreen() {
  const config = useBridgeConfig();

  const roamQuery = useQuery({
    queryKey: ['roam', config.roots.join(':'), config.roamRoots?.join(':') ?? ''],
    queryFn: () =>
      config.roamRoots && config.roamRoots.length > 0
        ? Promise.resolve(loadRoamGraph(config))
        : Promise.resolve({ nodes: [], links: [] })
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

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Roam Nodes</Text>
      <FlatList
        data={roamQuery.data?.nodes ?? []}
        horizontal
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.nodeList}
        renderItem={({ item }) => (
          <TouchableOpacity
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

      {selectedNode && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedNode.title}</Text>
          <Text style={styles.detailPath}>{selectedNode.path}</Text>
          <Text style={styles.sectionLabel}>Tags</Text>
          <View style={styles.tagRow}>
            {selectedNode.tags.length === 0 && <Text style={styles.emptyText}>No tags</Text>}
            {selectedNode.tags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.sectionLabel}>Backlinks</Text>
          {backlinks.length === 0 && <Text style={styles.emptyText}>No backlinks yet.</Text>}
          {backlinks.map((node) => (
            <Text key={node.id} style={styles.backlink}>
              • {node.title}
            </Text>
          ))}
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
