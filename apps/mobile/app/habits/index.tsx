import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { addHabitAsync, type AgendaItem, type Habit } from "@postep/bridge";
import { useBridgeConfig, useOrgConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import {
  completeHabitForConfig,
  deleteHabitForConfig,
  loadAgendaSnapshotForConfig,
} from "../../lib/agendaSources";

function bareHabitTitle(title: string) {
  return title.replace(/^[A-Z][A-Z_-]*\s+/, "").trim();
}

function agendaItemForHabit(habit: Habit, items: AgendaItem[]) {
  if (habit.path && habit.headline_line !== undefined) {
    const match = items.find(
      (item) =>
        item.path === habit.path && item.headline_line === habit.headline_line,
    );
    if (match) {
      return match;
    }
  }
  const title = bareHabitTitle(habit.title);
  return items.find((item) => bareHabitTitle(item.title) === title) ?? null;
}

export default function HabitsScreen() {
  const config = useBridgeConfig();
  const hasHydratedConfig = useOrgConfig((state) => state.hasHydrated);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("New habit");
  const [scheduled, setScheduled] = useState("2026-05-15 Fri 08:00");
  const agendaKey = [
    "agenda",
    config.roots.join(":"),
    config.roamRoots?.join(":") ?? "",
  ];

  const agendaQuery = useQuery({
    queryKey: agendaKey,
    queryFn: () =>
      config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0
        ? Promise.resolve({ items: [], habits: [] })
        : loadAgendaSnapshotForConfig(config),
    enabled: hasHydratedConfig,
  });

  useBridgeEvent("agendaChanged", () => agendaQuery.refetch());
  useBridgeEvent("rootsChanged", () => agendaQuery.refetch());

  const habits = useMemo(
    () => agendaQuery.data?.habits ?? [],
    [agendaQuery.data?.habits],
  );

  const handleAddHabit = async () => {
    if (
      (config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0) ||
      !title.trim()
    ) {
      return;
    }
    const snapshot = await addHabitAsync({
      roots: config.roots,
      roamRoots: config.roamRoots,
      title: title.trim(),
      scheduled: scheduled.trim() || "2026-05-15 Fri 08:00",
    });
    queryClient.setQueryData(agendaKey, snapshot);
    setTitle("New habit");
  };

  const handleCompleteHabit = async (habit: Habit) => {
    const item = agendaItemForHabit(habit, agendaQuery.data?.items ?? []);
    if (!item) {
      console.warn("Habit is missing source metadata", habit.title);
      return;
    }
    const snapshot = await completeHabitForConfig(
      config,
      item,
      agendaQuery.data,
    );
    queryClient.setQueryData(agendaKey, snapshot);
  };

  const handleDeleteHabit = async (habit: Habit) => {
    if (config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0) {
      return;
    }
    const snapshot = await deleteHabitForConfig(
      config,
      habit,
      agendaQuery.data,
    );
    queryClient.setQueryData(agendaKey, snapshot);
  };

  return (
    <View style={styles.container} testID="habits-screen">
      <View style={styles.editor} testID="habit-editor">
        <Text style={styles.editorTitle}>Add Habit</Text>
        <View style={styles.editorRow}>
          <TextInput
            testID="habit-title-input"
            style={[styles.input, styles.titleInput]}
            value={title}
            onChangeText={setTitle}
            placeholder="Habit title"
            placeholderTextColor="#6B7285"
          />
          <TouchableOpacity
            testID="habit-add-button"
            style={styles.addButton}
            onPress={handleAddHabit}
          >
            <Text style={styles.buttonText}>Add</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          testID="habit-scheduled-input"
          style={styles.input}
          value={scheduled}
          onChangeText={setScheduled}
          placeholder="2026-05-15 Fri 08:00"
          placeholderTextColor="#6B7285"
        />
      </View>

      {agendaQuery.isFetching && habits.length > 0 && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator size="small" color="#DDE5D4" />
          <Text style={styles.loadingText}>Refreshing habits…</Text>
        </View>
      )}

      <FlatList
        testID="habits-list"
        style={styles.list}
        data={habits}
        keyExtractor={(item, index) =>
          `${item.path ?? item.title}:${item.headline_line ?? index}`
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.card} testID="habit-card">
            <View style={styles.cardHeader}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.streak}>{item.last_repeat ?? "—"}</Text>
            </View>
            {item.scheduled && (
              <Text style={styles.meta}>Scheduled {item.scheduled}</Text>
            )}
            {item.description ? (
              <Text style={styles.description}>{item.description}</Text>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity
                testID={`habit-done-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
                style={styles.doneButton}
                onPress={() => handleCompleteHabit(item)}
              >
                <Text style={styles.doneText}>Done today</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID={`habit-delete-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
                style={styles.deleteButton}
                onPress={() => handleDeleteHabit(item)}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            {!hasHydratedConfig ||
            agendaQuery.isPending ||
            agendaQuery.isFetching ? (
              <ActivityIndicator color="#DDE5D4" />
            ) : null}
            <Text style={styles.emptyText}>
              {!hasHydratedConfig ||
              agendaQuery.isPending ||
              agendaQuery.isFetching
                ? "Loading habits from your Org files..."
                : "Habits will appear after parsing org-habit entries."}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#071008",
  },
  editor: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#091108",
    borderBottomWidth: 1,
    borderBottomColor: "#303B2D",
  },
  editorTitle: {
    color: "#F0F4EA",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  editorRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  input: {
    backgroundColor: "#0C150B",
    color: "#F2F5EC",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    marginBottom: 7,
    borderWidth: 1,
    borderColor: "#303B2D",
    fontSize: 13,
    lineHeight: 17,
  },
  titleInput: {
    flex: 1,
  },
  addButton: {
    backgroundColor: "#4D5F31",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
  },
  loadingBanner: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#111A10",
    borderBottomWidth: 1,
    borderBottomColor: "#303B2D",
  },
  loadingText: {
    color: "#DDE5D4",
    fontSize: 11,
    lineHeight: 14,
  },
  list: {
    flex: 1,
    backgroundColor: "#071008",
  },
  listContent: {
    padding: 8,
  },
  card: {
    backgroundColor: "#091108",
    padding: 8,
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#3D4638",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    color: "#F2F5EC",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    flex: 1,
  },
  streak: {
    color: "#9BA394",
    fontSize: 11,
    lineHeight: 15,
  },
  meta: {
    color: "#9BA394",
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
  },
  description: {
    marginTop: 4,
    color: "#C6CDBF",
    fontSize: 11,
    lineHeight: 14,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  doneButton: {
    backgroundColor: "#394A23",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  doneText: {
    color: "#F1F5E8",
    fontWeight: "900",
    fontSize: 11,
  },
  deleteButton: {
    backgroundColor: "#352019",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  deleteText: {
    color: "#F0C0B0",
    fontWeight: "800",
    fontSize: 11,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 10,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
});
