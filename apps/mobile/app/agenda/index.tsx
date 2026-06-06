import React, { useMemo, useState } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  loadAgendaSnapshotAsync,
  setAgendaStatusAsync,
  type AgendaItem,
} from "@postep/bridge";
import { useBridgeConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";

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

function groupByDay(items: AgendaItem[]) {
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
      list: todayItems,
      tone: "today",
    });
  }
  if (missed.length > 0) {
    groups.push({
      date: "missed",
      title: `Missed · ${missed.length} overdue`,
      list: missed,
      tone: "missed",
    });
  }
  for (const [date, list] of Object.entries(upcomingMap).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    groups.push({ date, title: date, list, tone: "upcoming" });
  }
  if (inbox.length > 0) {
    groups.push({
      date: "unscheduled",
      title: "Inbox",
      list: inbox,
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

  return visible.filter(Boolean).slice(0, 3);
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

export default function AgendaScreen() {
  const queryClient = useQueryClient();
  const config = useBridgeConfig();
  const [pickerItem, setPickerItem] = useState<AgendaItem | null>(null);

  const agendaQuery = useQuery({
    queryKey: [
      "agenda",
      config.roots.join(":"),
      config.roamRoots?.join(":") ?? "",
    ],
    queryFn: () =>
      config.roots.length === 0
        ? Promise.resolve({ items: [], habits: [] })
        : loadAgendaSnapshotAsync(config),
  });

  useBridgeEvent("agendaChanged", () => agendaQuery.refetch());
  useBridgeEvent("rootsChanged", () => agendaQuery.refetch());

  const groups = useMemo(
    () => groupByDay(agendaQuery.data?.items ?? []),
    [agendaQuery.data?.items],
  );

  const applyStatus = async (item: AgendaItem, status: string) => {
    if (config.roots.length === 0) {
      return;
    }
    try {
      const snapshot = await setAgendaStatusAsync({
        roots: config.roots,
        roamRoots: config.roamRoots,
        path: item.path,
        headlineLine: item.headline_line,
        status,
      });
      queryClient.setQueryData(
        ["agenda", config.roots.join(":"), config.roamRoots?.join(":") ?? ""],
        snapshot,
      );
    } catch (error) {
      console.warn("Failed to set agenda status", error);
    }
  };

  const currentStatusLabel = (item: AgendaItem) => {
    const keyword = item.todo_keyword ?? item.kind;
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
            onRefresh={() => agendaQuery.refetch()}
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
              return (
                <View
                  key={`${agenda.path}:${agenda.headline_line}`}
                  testID={`agenda-card-${agenda.headline_line}`}
                  style={styles.cardRow}
                >
                  <View style={styles.cardHeaderRow}>
                    <TouchableOpacity
                      style={styles.statusChip}
                      onPress={() => setPickerItem(agenda)}
                      testID={`agenda-status-${agenda.headline_line}`}
                    >
                      <Text style={styles.statusChipText}>
                        {currentStatusLabel(agenda)}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.kindChip}>{agenda.kind}</Text>
                    <Text style={styles.dateChip}>
                      {formatScheduleLabel(agenda)}
                    </Text>
                    {age && (
                      <Text
                        style={
                          agenda.date && agenda.date < localDateString()
                            ? styles.overdueChip
                            : styles.ageChip
                        }
                      >
                        {age}
                      </Text>
                    )}
                    {repeater && (
                      <Text style={styles.repeaterChip}>{repeater}</Text>
                    )}
                  </View>
                  <Text style={styles.cardTitle}>{agenda.title}</Text>
                  {contextLines.length > 0 && (
                    <View style={styles.contextBlock}>
                      {contextLines.map((line, index) => (
                        <Text key={`${line}:${index}`} style={styles.cardMeta}>
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
              No agenda items. Add scheduled TODOs in your Org files.
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
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  sectionTitle: {
    fontSize: 16,
    color: "#9BA394",
    textTransform: "uppercase",
    marginBottom: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  todayTitle: { color: "#E5EBDD" },
  missedTitle: { color: "#E8B7A8" },
  cardRow: {
    marginBottom: 12,
    backgroundColor: "#091108",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#3D4638",
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 12,
    alignItems: "center",
  },
  statusChip: {
    backgroundColor: "#394A23",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusChipText: {
    color: "#F1F5E8",
    fontWeight: "900",
    fontSize: 12,
  },
  kindChip: {
    color: "#DDE5D4",
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    overflow: "hidden",
    fontWeight: "800",
  },
  dateChip: {
    color: "#C9D1C0",
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    overflow: "hidden",
  },
  ageChip: {
    color: "#C9D1C0",
    backgroundColor: "#1E271B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    overflow: "hidden",
    fontWeight: "800",
  },
  overdueChip: {
    color: "#F0C0B0",
    backgroundColor: "#352019",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    overflow: "hidden",
    fontWeight: "900",
  },
  repeaterChip: {
    color: "#CDE8B4",
    backgroundColor: "#24371B",
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    overflow: "hidden",
    fontWeight: "800",
  },
  cardTitle: {
    color: "#F2F5EC",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    marginBottom: 8,
  },
  contextBlock: {
    gap: 5,
  },
  cardMeta: {
    color: "#C6CDBF",
    fontSize: 19,
    lineHeight: 27,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 18,
    lineHeight: 25,
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
