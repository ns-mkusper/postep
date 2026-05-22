import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { addHabit, deleteHabit, loadAgendaSnapshot } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';

export default function HabitsScreen() {
  const config = useBridgeConfig();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('New habit');
  const [scheduled, setScheduled] = useState('2026-05-15 Fri 08:00');
  const agendaKey = ['agenda', config.roots.join(':'), config.roamRoots?.join(':') ?? ''];

  const agendaQuery = useQuery({
    queryKey: agendaKey,
    queryFn: () =>
      config.roots.length === 0
        ? Promise.resolve({ items: [], habits: [] })
        : Promise.resolve(loadAgendaSnapshot(config))
  });

  useBridgeEvent('agendaChanged', () => agendaQuery.refetch());
  useBridgeEvent('rootsChanged', () => agendaQuery.refetch());

  const habits = useMemo(() => agendaQuery.data?.habits ?? [], [agendaQuery.data?.habits]);

  const handleAddHabit = () => {
    if (config.roots.length === 0 || !title.trim()) {
      return;
    }
    const snapshot = addHabit({
      roots: config.roots,
      roamRoots: config.roamRoots,
      title: title.trim(),
      scheduled: scheduled.trim() || '2026-05-15 Fri 08:00'
    });
    queryClient.setQueryData(agendaKey, snapshot);
    setTitle('New habit');
  };

  const handleDeleteHabit = (habitTitle: string) => {
    if (config.roots.length === 0) {
      return;
    }
    const snapshot = deleteHabit({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: `${config.roots[0]}/sample-01.org`,
      title: habitTitle.replace(/^TODO\s+/, '')
    });
    queryClient.setQueryData(agendaKey, snapshot);
  };

  return (
    <View style={styles.container} testID="habits-screen">
      <View style={styles.editor} testID="habit-editor">
        <Text style={styles.editorTitle}>Add Habit</Text>
        <TextInput
          testID="habit-title-input"
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Habit title"
          placeholderTextColor="#6B7285"
        />
        <TextInput
          testID="habit-scheduled-input"
          style={styles.input}
          value={scheduled}
          onChangeText={setScheduled}
          placeholder="2026-05-15 Fri 08:00"
          placeholderTextColor="#6B7285"
        />
        <TouchableOpacity testID="habit-add-button" style={styles.addButton} onPress={handleAddHabit}>
          <Text style={styles.buttonText}>Add Habit</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        testID="habits-list"
        style={styles.list}
        data={habits}
        keyExtractor={(item, index) => `${item.title}:${index}`}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card} testID="habit-card">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.streak}>{item.last_repeat ?? '—'}</Text>
            </View>
            <Text style={styles.description}>{item.description}</Text>
            <TouchableOpacity
              testID={`habit-delete-${item.title.replace(/\s+/g, '-').toLowerCase()}`}
              style={styles.deleteButton}
              onPress={() => handleDeleteHabit(item.title)}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Habits will appear after parsing org-habit entries.</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C0D0F'
  },
  editor: {
    padding: 16,
    backgroundColor: '#151A22',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)'
  },
  editorTitle: {
    color: '#F0F2F9',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  input: {
    backgroundColor: '#0B0F16',
    color: '#F5F6FA',
    padding: 10,
    borderRadius: 10,
    marginBottom: 8
  },
  addButton: {
    backgroundColor: '#4C6EF5',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700'
  },
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
  deleteButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#3B1F2A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  deleteText: {
    color: '#FDA4AF',
    fontWeight: '700'
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
