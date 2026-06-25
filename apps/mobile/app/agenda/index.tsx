import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Pressable,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { type AgendaItem } from "@postep/bridge";
import { useBridgeConfig, useOrgConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import {
  loadAgendaSnapshotForConfig,
  setAgendaStatusForConfig,
} from "../../lib/agendaSources";
import { clearDocumentSourceCache } from "../../lib/documentSources";
import { agendaQueryKey, hasConfiguredOrgRoots } from "../../lib/queryKeys";

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "TODO (t)", value: "TODO" },
  { label: "WAITING (w)", value: "WAITING" },
  { label: "INPROG-TODO (i)", value: "INPROG-TODO" },
  { label: "HW (h)", value: "HW" },
  { label: "STUDY (s)", value: "STUDY" },
  { label: "SOMEDAY", value: "SOMEDAY" },
  { label: "READ (r)", value: "READ" },
  { label: "PROJ (p)", value: "PROJ" },
  { label: "CONTACT (c)", value: "CONTACT" },
  { label: "DONE (d)", value: "DONE" },
  { label: "CANCELLED (C)", value: "CANCELLED" },
];

const QUICK_STATUS_OPTIONS = [
  { label: "TODO", value: "TODO" },
  { label: "Doing", value: "INPROG-TODO" },
  { label: "Done", value: "DONE" },
  { label: "Cancel", value: "CANCELLED" },
];

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(date: string, today: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${today}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function ageLabel(item: AgendaItem, today: string) {
  if (!item.date) {
    return null;
  }
  const age = daysBetween(item.date, today);
  if (age > 0) {
    return `${age}d overdue`;
  }
  if (age === 0) {
    return "Today";
  }
  return `In ${Math.abs(age)}d`;
}

function agendaItemKey(item: AgendaItem) {
  return `${item.path}:${item.headline_line ?? item.title}:${item.date ?? ""}`;
}

function agendaStatusKeyword(item: AgendaItem) {
  return item.todo_keyword ?? item.kind;
}

function agendaItemDoneLike(item: AgendaItem) {
  return isDoneLikeStatus(agendaStatusKeyword(item));
}

function orderAgendaItems(items: AgendaItem[], preserveOrderKeys?: string[] | null) {
  if (preserveOrderKeys?.length) {
    const rank = new Map(preserveOrderKeys.map((key, index) => [key, index]));
    return [...items].sort((left, right) => {
      const leftRank = rank.get(agendaItemKey(left)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(agendaItemKey(right)) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    });
  }
  return [...items].sort((left, right) => {
    const leftDone = agendaItemDoneLike(left);
    const rightDone = agendaItemDoneLike(right);
    if (leftDone === rightDone) {
      return 0;
    }
    return leftDone ? 1 : -1;
  });
}

function groupByDay(items: AgendaItem[], preserveOrderKeys?: string[] | null) {
  const today = localDateString();
  const missed = items.filter((item) => item.date && item.date < today);
  const todayItems = items.filter((item) => item.date === today);
  const upcomingMap: Record<string, AgendaItem[]> = {};
  const inbox: AgendaItem[] = [];

  for (const item of items) {
    if (!item.date) {
      inbox.push(item);
      continue;
    }
    if (item.date < today || item.date === today) {
      continue;
    }
    upcomingMap[item.date] = upcomingMap[item.date] ?? [];
    upcomingMap[item.date].push(item);
  }

  const groups: Array<{
    date: string;
    title: string;
    list: AgendaItem[];
    tone?: "missed" | "today" | "upcoming" | "inbox";
  }> = [];
  if (todayItems.length > 0) {
    groups.push({
      date: today,
      title: "Today",
      list: orderAgendaItems(todayItems, preserveOrderKeys),
      tone: "today",
    });
  }
  if (missed.length > 0) {
    groups.push({
      date: "missed",
      title: `Missed · ${missed.length} overdue`,
      list: orderAgendaItems(missed, preserveOrderKeys),
      tone: "missed",
    });
  }
  for (const [date, list] of Object.entries(upcomingMap).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    groups.push({
      date,
      title: date,
      list: orderAgendaItems(list, preserveOrderKeys),
      tone: "upcoming",
    });
  }
  if (inbox.length > 0) {
    groups.push({
      date: "unscheduled",
      title: "Inbox",
      list: orderAgendaItems(inbox, preserveOrderKeys),
      tone: "inbox",
    });
  }
  return groups;
}

function cleanOrgText(text: string) {
  return text
    .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAgendaContext(context: string) {
  const lines = context.split("\n");
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
      visible.push(
        cleanOrgText(
          line
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(" · "),
        ),
      );
      continue;
    }
    visible.push(cleanOrgText(line));
  }

  return visible.filter(Boolean).slice(0, 2);
}

function formatRepeater(item: AgendaItem) {
  if (!item.repeater) {
    return null;
  }
  const unit = item.repeater.unit.toLowerCase();
  return `Every ${item.repeater.amount} ${unit}${item.repeater.amount === 1 ? "" : "s"}`;
}

function formatScheduleLabel(item: AgendaItem) {
  const parts = [item.date, item.time].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : item.kind;
}

function isDoneLikeStatus(status?: string | null) {
  const normalized = status?.toUpperCase();
  return (
    normalized === "DONE" ||
    normalized === "CANCELLED" ||
    normalized === "CANCELED"
  );
}

export default function AgendaScreen() {
  const queryClient = useQueryClient();
  const config = useBridgeConfig();
  const hasHydratedConfig = useOrgConfig((state) => state.hasHydrated);
  const [pickerItem, setPickerItem] = useState<AgendaItem | null>(null);
  const [preserveOrderKeys, setPreserveOrderKeys] = useState<string[] | null>(null);
  const hasConfiguredRoots = hasConfiguredOrgRoots(config);
  const agendaKey = agendaQueryKey(config);
  const cachedAgenda = queryClient.getQueryData<Awaited<ReturnType<typeof loadAgendaSnapshotForConfig>>>(agendaKey);

  const agendaQuery = useQuery({
    queryKey: agendaKey,
    queryFn: () =>
      hasConfiguredRoots
        ? loadAgendaSnapshotForConfig(config)
        : Promise.resolve({ items: [], habits: [] }),
    enabled: hasHydratedConfig,
    initialData: cachedAgenda,
  });

  const refreshAgenda = useCallback(() => {
    clearDocumentSourceCache();
    setPreserveOrderKeys(null);
    return agendaQuery.refetch();
  }, [agendaQuery]);

  useBridgeEvent("agendaChanged", refreshAgenda);
  useBridgeEvent("rootsChanged", refreshAgenda);

  useFocusEffect(
    useCallback(
      () => () => {
        setPreserveOrderKeys(null);
      },
      [],
    ),
  );

  const groups = useMemo(
    () => groupByDay(agendaQuery.data?.items ?? [], preserveOrderKeys),
    [agendaQuery.data?.items, preserveOrderKeys],
  );

  const applyStatus = async (item: AgendaItem, status: string) => {
    if (!hasConfiguredRoots) {
      return;
    }
    try {
      setPreserveOrderKeys(groups.flatMap((group) => group.list.map(agendaItemKey)));
      const snapshot = await setAgendaStatusForConfig(
        config,
        item,
        status,
        agendaQuery.data,
      );
      queryClient.setQueryData(agendaKey, snapshot);
    } catch (error) {
      console.warn("Failed to set agenda status", error);
    }
  };

  const currentStatusLabel = (item: AgendaItem) => {
    const keyword = agendaStatusKeyword(item);
    const match = STATUS_OPTIONS.find(
      (opt) => opt.value.toUpperCase() === keyword.toUpperCase(),
    );
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
          <RefreshControl
            refreshing={agendaQuery.isRefetching}
            onRefresh={refreshAgenda}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                item.tone === "today" && styles.todayTitle,
                item.tone === "missed" && styles.missedTitle,
              ]}
            >
              {item.title}
            </Text>
            {item.list.map((agenda) => {
              const contextLines = cleanAgendaContext(agenda.context);
              const repeater = formatRepeater(agenda);
              const age = ageLabel(agenda, localDateString());
              const status = currentStatusLabel(agenda);
              const completed = isDoneLikeStatus(status);
              return (
                <View
                  key={`${agenda.path}:${agenda.headline_line}`}
                  testID={`agenda-card-${agenda.headline_line}`}
                  style={[styles.cardRow, completed && styles.cardRowDone]}
                >
                  <View style={styles.cardHeaderRow}>
                    <TouchableOpacity
                      style={[styles.statusChip, completed && styles.statusChipDone]}
                      onPress={() => setPickerItem(agenda)}
                      testID={`agenda-status-${agenda.headline_line}`}
                    >
                      <Text
                        style={[
                          styles.statusChipText,
                          completed && styles.statusChipTextDone,
                        ]}
                      >
                        {status}
                      </Text>
                    </TouchableOpacity>
                    <Text style={[styles.kindChip, completed && styles.doneMutedChip]}>{agenda.kind}</Text>
                    <Text style={[styles.dateChip, completed && styles.doneMutedChip]}>
                      {formatScheduleLabel(agenda)}
                    </Text>
                    {age && (
                      <Text
                        style={
                          agenda.date && agenda.date < localDateString()
                            ? [styles.overdueChip, completed && styles.doneMutedChip]
                            : [styles.ageChip, completed && styles.doneMutedChip]
                        }
                      >
                        {age}
                      </Text>
                    )}
                    {repeater && (
                      <Text style={[styles.repeaterChip, completed && styles.doneMutedChip]}>{repeater}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={() =>
                      router.push({
                        pathname: "/library",
                        params: { encodedPath: encodeURIComponent(agenda.path) },
                      })
                    }
                    testID={`agenda-open-note-${agenda.headline_line}`}
                  >
                    <Text style={[styles.cardTitle, completed && styles.cardTitleDone]}>{agenda.title}</Text>
                  </TouchableOpacity>
                  <View style={styles.quickStatusRow}>
                    {QUICK_STATUS_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.quickStatusButton,
                          status === option.value && styles.quickStatusButtonActive,
                          completed && option.value === status &&
                            styles.quickStatusButtonDoneActive,
                        ]}
                        onPress={() => applyStatus(agenda, option.value)}
                        testID={`agenda-quick-${option.value.toLowerCase()}-${agenda.headline_line}`}
                      >
                        <Text style={[styles.quickStatusText, completed && styles.quickStatusTextDone]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {contextLines.length > 0 && (
                    <View style={styles.contextBlock}>
                      {contextLines.map((line, index) => (
                        <Text key={`${line}:${index}`} style={[styles.cardMeta, completed && styles.cardMetaDone]}>
                          {line}
                        </Text>
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
            <Text style={styles.emptyText}>
              {!hasHydratedConfig || agendaQuery.isPending
                ? "Loading agenda from your Org files..."
                : "No agenda items. Add scheduled TODOs in your Org files."}
            </Text>
          </View>
        )}
      />

      <Modal
        visible={pickerItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerItem(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPickerItem(null)}
        >
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
    backgroundColor: "#071008",
  },
  list: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 12,
    color: "#9BA394",
    textTransform: "uppercase",
    marginBottom: 6,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  todayTitle: { color: "#E5EBDD" },
  missedTitle: { color: "#E8B7A8" },
  cardRow: {
    marginBottom: 6,
    backgroundColor: "#091108",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3D4638",
    padding: 8,
  },
  cardRowDone: {
    backgroundColor: "#0A0F08",
    borderColor: "#2A3328",
    opacity: 0.82,
  },
  cardHeaderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 4,
    alignItems: "center",
  },
  statusChip: {
    backgroundColor: "#394A23",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  statusChipDone: {
    backgroundColor: "#2D3529",
  },
  statusChipText: {
    color: "#F1F5E8",
    fontWeight: "900",
    fontSize: 10,
  },
  statusChipTextDone: {
    color: "#AAB3A4",
    textDecorationLine: "line-through",
  },
  kindChip: {
    color: "#DDE5D4",
    backgroundColor: "#1E271B",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    overflow: "hidden",
    fontWeight: "800",
  },
  dateChip: {
    color: "#C9D1C0",
    backgroundColor: "#1E271B",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    overflow: "hidden",
  },
  ageChip: {
    color: "#C9D1C0",
    backgroundColor: "#1E271B",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    overflow: "hidden",
    fontWeight: "800",
  },
  overdueChip: {
    color: "#F0C0B0",
    backgroundColor: "#352019",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    overflow: "hidden",
    fontWeight: "900",
  },
  repeaterChip: {
    color: "#CDE8B4",
    backgroundColor: "#24371B",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    overflow: "hidden",
    fontWeight: "800",
  },
  doneMutedChip: {
    color: "#8F978A",
    backgroundColor: "#171E15",
  },
  cardTitle: {
    color: "#F2F5EC",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    marginBottom: 5,
  },
  cardTitleDone: {
    color: "#8F978A",
    textDecorationLine: "line-through",
    textDecorationColor: "#8F978A",
  },
  quickStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: 5,
  },
  quickStatusButton: {
    backgroundColor: "#182116",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#33402F",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  quickStatusButtonActive: {
    backgroundColor: "#394A23",
    borderColor: "#718049",
  },
  quickStatusButtonDoneActive: {
    backgroundColor: "#2D3529",
    borderColor: "#5D6658",
  },
  quickStatusText: {
    color: "#DDE5D4",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
  },
  quickStatusTextDone: {
    color: "#AAB3A4",
  },
  contextBlock: {
    gap: 2,
  },
  cardMeta: {
    color: "#C6CDBF",
    fontSize: 11,
    lineHeight: 14,
  },
  cardMetaDone: {
    color: "#828A7D",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#111A10",
    borderRadius: 18,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#3D4638",
  },
  modalTitle: {
    color: "#F2F5EC",
    fontSize: 20,
    fontWeight: "700",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  modalOption: {
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  modalOptionText: {
    color: "#DDE5D4",
    fontSize: 17,
  },
});
