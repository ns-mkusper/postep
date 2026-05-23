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

function cleanOrgText(text: string) {
  return text
    .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAgendaContext(context: string) {
  const lines = context.split('\n');
  const visible: string[] = [];
  let inDrawer = false;
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^:(PROPERTIES|LOGBOOK|[A-Z0-9_+-]+):$/i.test(line)) {
      inDrawer = true;
      continue;
    }
    if (/^:END:$/i.test(line)) {
      inDrawer = false;
      continue;
    }
    if (inDrawer) {
      continue;
    }
    if (/^#\+BEGIN_/i.test(line)) {
      inCode = true;
      continue;
    }
    if (/^#\+END_/i.test(line)) {
      inCode = false;
      continue;
    }
    if (inCode) {
      continue;
    }
    if (/^(SCHEDULED|DEADLINE|CLOSED):/i.test(line)) {
      continue;
    }
    if (/^:[^:]+:/.test(line)) {
      continue;
    }
    if (/^State ".*" from ".*" \[/.test(line)) {
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      visible.push(cleanOrgText(line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()).filter(Boolean).join(' · ')));
      continue;
    }
    visible.push(cleanOrgText(line));
  }

  return visible.filter(Boolean).slice(0, 3);
}

function formatRepeater(item: AgendaItem) {
  if (!item.repeater) {
    return null;
  }
  const unit = item.repeater.unit.toLowerCase();
  return `Every ${item.repeater.amount} ${unit}${item.repeater.amount === 1 ? '' : 's'}`;
}

function formatScheduleLabel(item: AgendaItem) {
  const parts = [item.date, item.time].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : item.kind;
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
    <View style={styles.container} testID="agenda-screen">
      <FlatList
        testID="agenda-list"
        style={styles.list}
        data={groups}
        keyExtractor={(item) => item.date}
        refreshControl={
          <RefreshControl refreshing={agendaQuery.isRefetching} onRefresh={() => agendaQuery.refetch()} />
        }
        renderItem={({ item }) => (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{item.date === 'unscheduled' ? 'Inbox' : item.date}</Text>
            {item.list.map((agenda) => {
              const contextLines = cleanAgendaContext(agenda.context);
              const repeater = formatRepeater(agenda);
              return (
                <View key={`${agenda.path}:${agenda.headline_line}`} testID={`agenda-card-${agenda.headline_line}`} style={styles.cardRow}>
                  <View style={styles.cardHeaderRow}>
                    <TouchableOpacity
                      style={styles.statusChip}
                      onPress={() => setPickerItem(agenda)}
                      testID={`agenda-status-${agenda.headline_line}`}
                    >
                      <Text style={styles.statusChipText}>{currentStatusLabel(agenda)}</Text>
                    </TouchableOpacity>
                    <Text style={styles.kindChip}>{agenda.kind}</Text>
                    <Text style={styles.dateChip}>{formatScheduleLabel(agenda)}</Text>
                    {repeater && <Text style={styles.repeaterChip}>{repeater}</Text>}
                  </View>
                  <Text style={styles.cardTitle}>{agenda.title}</Text>
                  {contextLines.length > 0 && (
                    <View style={styles.contextBlock}>
                      {contextLines.map((line, index) => (
                        <Text key={`${line}:${index}`} style={styles.cardMeta}>{line}</Text>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
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
    marginBottom: 12,
    fontWeight: '800'
  },
  cardRow: {
    marginBottom: 12,
    backgroundColor: '#1A1D23',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#303541',
    padding: 16
  },
  cardHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    alignItems: 'center'
  },
  statusChip: {
    backgroundColor: '#B8C6F4',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  statusChipText: {
    color: '#111217',
    fontWeight: '900',
    fontSize: 12
  },
  kindChip: {
    color: '#DCE3F7',
    backgroundColor: '#283044',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    overflow: 'hidden',
    fontWeight: '800'
  },
  dateChip: {
    color: '#C9D3EF',
    backgroundColor: '#222838',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    overflow: 'hidden'
  },
  repeaterChip: {
    color: '#BDF7D3',
    backgroundColor: '#173828',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    overflow: 'hidden',
    fontWeight: '800'
  },
  cardTitle: {
    color: '#F3F4F8',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8
  },
  contextBlock: {
    gap: 4
  },
  cardMeta: {
    color: '#AAB1C4',
    fontSize: 14,
    lineHeight: 20
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
