import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Pressable
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { loadAgendaSnapshot, setAgendaStatus, AgendaItem } from '@postep/bridge';
import { useBridgeConfig } from '../../store/orgConfig';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'TODO (t)', value: 'TODO' },
  { label: 'WAITING (w)', value: 'WAITING' },
  { label: 'INPROG-TODO (i)', value: 'INPROG-TODO' },
  { label: 'HW (h)', value: 'HW' },
  { label: 'STUDY (s)', value: 'STUDY' },
  { label: 'SOMEDAY', value: 'SOMEDAY' },
  { label: 'READ (r)', value: 'READ' },
  { label: 'PROJ (p)', value: 'PROJ' },
  { label: 'CONTACT (c)', value: 'CONTACT' },
  { label: 'DONE (d)', value: 'DONE' },
  { label: 'CANCELLED (C)', value: 'CANCELLED' }
];

function groupByDay(items: AgendaItem[]) {
  const groups: Record<string, AgendaItem[]> = {};
  for (const item of items) {
    const key = item.date ?? 'unscheduled';
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
  }
  return Object.entries(groups).map(([date, list]) => ({ date, list }));
}

export default function AgendaScreen() {
  const queryClient = useQueryClient();
  const config = useBridgeConfig();
  const [pickerItem, setPickerItem] = useState<AgendaItem | null>(null);

  const agendaQuery = useQuery({
    queryKey: ['agenda', config.roots.join(':'), config.roamRoots?.join(':') ?? ''],
    queryFn: () =>
      config.roots.length === 0
        ? Promise.resolve({ items: [], habits: [] })
        : Promise.resolve(loadAgendaSnapshot(config))
  });

  useBridgeEvent('agendaChanged', () => agendaQuery.refetch());
  useBridgeEvent('rootsChanged', () => agendaQuery.refetch());

  const groups = useMemo(() => groupByDay(agendaQuery.data?.items ?? []), [agendaQuery.data?.items]);

  const applyStatus = async (item: AgendaItem, status: string) => {
    if (config.roots.length === 0) {
      return;
    }
    try {
      const snapshot = setAgendaStatus({
        roots: config.roots,
        roamRoots: config.roamRoots,
        path: item.path,
        headlineLine: item.headline_line,
        status
      });
      queryClient.setQueryData(['agenda', config.roots.join(':'), config.roamRoots?.join(':') ?? ''], snapshot);
    } catch (error) {
      console.warn('Failed to set agenda status', error);
    }
  };

  const currentStatusLabel = (item: AgendaItem) => {
    const keyword = item.todo_keyword ?? item.kind;
    const match = STATUS_OPTIONS.find((opt) => opt.value.toUpperCase() === keyword.toUpperCase());
    return match ? match.value : keyword;
  };

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={groups}
        keyExtractor={(item) => item.date}
        refreshControl={
          <RefreshControl refreshing={agendaQuery.isRefetching} onRefresh={() => agendaQuery.refetch()} />
        }
        renderItem={({ item }) => (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{item.date === 'unscheduled' ? 'Inbox' : item.date}</Text>
            {item.list.map((agenda) => (
              <View key={`${agenda.path}:${agenda.headline_line}`} style={styles.cardRow}>
                <TouchableOpacity
                  style={styles.statusButton}
                  onPress={() => setPickerItem(agenda)}
                >
                  <Text style={styles.statusButtonText}>{currentStatusLabel(agenda)}</Text>
                </TouchableOpacity>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{agenda.title}</Text>
                  <Text style={styles.cardMeta}>{agenda.context}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No agenda items. Add scheduled TODOs in your Org files.</Text>
          </View>
        )}
      />

      <Modal
        visible={pickerItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerItem(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPickerItem(null)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set status</Text>
            {pickerItem &&
              STATUS_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.modalOption}
                  onPress={() => {
                    setPickerItem(null);
                    applyStatus(pickerItem, option.value);
                  }}
                >
                  <Text style={styles.modalOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050607'
  },
  list: {
    flex: 1
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 20
  },
  sectionTitle: {
    fontSize: 14,
    color: '#7A8499',
    textTransform: 'uppercase',
    marginBottom: 12
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 12,
    backgroundColor: '#1A1D23',
    borderRadius: 12,
    overflow: 'hidden'
  },
  statusButton: {
    paddingHorizontal: 12,
    paddingVertical: 18,
    backgroundColor: '#2B3347',
    justifyContent: 'center'
  },
  statusButtonText: {
    color: '#F4F6FF',
    fontWeight: '600'
  },
  cardBody: {
    flex: 1,
    padding: 16
  },
  cardTitle: {
    color: '#F3F4F8',
    fontSize: 16,
    marginBottom: 6
  },
  cardMeta: {
    color: '#8891AA',
    fontSize: 12
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40
  },
  emptyText: {
    color: '#71788D'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24
  },
  modalContent: {
    backgroundColor: '#182030',
    borderRadius: 12,
    paddingVertical: 16
  },
  modalTitle: {
    color: '#F2F4FE',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingBottom: 12
  },
  modalOption: {
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  modalOptionText: {
    color: '#D7DFF6',
    fontSize: 14
  }
});
