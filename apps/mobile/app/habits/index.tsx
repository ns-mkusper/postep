import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { loadAgendaSnapshot } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';

export default function HabitsScreen() {
  const config = useBridgeConfig();

  const agendaQuery = useQuery({
    queryKey: ['agenda', config.roots.join(':'), config.roamRoots?.join(':') ?? ''],
    queryFn: () =>
      config.roots.length === 0
        ? Promise.resolve({ items: [], habits: [] })
        : Promise.resolve(loadAgendaSnapshot(config))
  });

  useBridgeEvent('agendaChanged', () => agendaQuery.refetch());
  useBridgeEvent('rootsChanged', () => agendaQuery.refetch());

  const habits = useMemo(() => agendaQuery.data?.habits ?? [], [agendaQuery.data?.habits]);

  return (
    <FlatList
      style={styles.list}
      data={habits}
      keyExtractor={(item) => item.title}
      contentContainerStyle={{ padding: 16 }}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.streak}>{item.last_repeat ?? '—'}</Text>
          </View>
          <Text style={styles.description}>{item.description}</Text>
        </View>
      )}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Habits will appear after parsing org-habit entries.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#0C0D0F'
  },
  card: {
    backgroundColor: '#1F2430',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12
  },
  title: {
    color: '#F0F2F9',
    fontSize: 16,
    fontWeight: '600'
  },
  streak: {
    color: '#A5ADC4',
    fontSize: 12
  },
  description: {
    marginTop: 8,
    color: '#C1C7D9'
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  emptyText: {
    color: '#6B7285'
  }
});
