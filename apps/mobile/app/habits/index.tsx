import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  FlatList,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { addHabitAsync, type AgendaItem, type Habit } from "@postep/bridge";
import { useBridgeConfig, useOrgConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import {
  completeHabitForConfig,
  deleteHabitForConfig,
  loadAgendaSnapshotForConfig,
} from "../../lib/agendaSources";
import { clearDocumentSourceCache } from "../../lib/documentSources";
import { agendaQueryKey, hasConfiguredOrgRoots } from "../../lib/queryKeys";

function bareHabitTitle(title: string) {
  return title.replace(/^[A-Z][A-Z_-]*\s+/, "").trim();
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function habitKey(habit: Habit) {
  return `${habit.path ?? habit.title}:${habit.headline_line ?? bareHabitTitle(habit.title)}`;
}

function openNotePath(path?: string | null) {
  if (!path) {
    return;
  }
  router.push({
    pathname: "/library",
    params: { encodedPath: encodeURIComponent(path) },
  });
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
  const [pendingHabitKey, setPendingHabitKey] = useState<string | null>(null);
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);
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

  useBridgeEvent("agendaChanged", () => {
    clearDocumentSourceCache();
    void agendaQuery.refetch();
  });
  useBridgeEvent("rootsChanged", () => {
    clearDocumentSourceCache();
    void agendaQuery.refetch();
  });

  const habits = useMemo(
    () => agendaQuery.data?.habits ?? [],
    [agendaQuery.data?.habits],
  );

  const handleAddHabit = async () => {
    if (
      !hasConfiguredRoots ||
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
    const key = `done:${habitKey(habit)}`;
    const item = agendaItemForHabit(habit, agendaQuery.data?.items ?? []);
    if (!item) {
      console.warn("Habit is missing source metadata", habit.title);
      return;
    }
    setPendingHabitKey(key);
    try {
      const snapshot = await completeHabitForConfig(
        config,
        item,
        agendaQuery.data,
      );
      queryClient.setQueryData(agendaKey, snapshot);
    } finally {
      setPendingHabitKey(null);
    }
  };

  const handleDeleteHabit = async (habit: Habit) => {
    if (!hasConfiguredRoots) {
      return;
    }
    const key = `delete:${habitKey(habit)}`;
    setPendingHabitKey(key);
    try {
      const snapshot = await deleteHabitForConfig(
        config,
        habit,
        agendaQuery.data,
      );
      queryClient.setQueryData(agendaKey, snapshot);
      setMenuHabit(null);
    } finally {
      setPendingHabitKey(null);
    }
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
        renderItem={({ item }) => {
          const today = localDateString();
          const doneToday = item.todo_keyword === "DONE" || item.last_repeat === today;
          const key = habitKey(item);
          const completing = pendingHabitKey === `done:${key}`;
          const deleting = pendingHabitKey === `delete:${key}`;
          const pending = completing || deleting;
          return (
            <View
              style={[styles.card, doneToday && styles.cardDoneToday]}
              testID="habit-card"
            >
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity
                    style={styles.titleButton}
                    activeOpacity={0.75}
                    onPress={() => openNotePath(item.path)}
                    disabled={!item.path}
                    testID={`habit-open-note-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <Text style={[styles.title, doneToday && styles.titleDone]}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                  <Text style={[styles.streak, doneToday && styles.streakDone]}>
                    {doneToday ? "Done today" : item.last_repeat ?? "—"}
                  </Text>
                </View>
                {item.scheduled && (
                  <Text style={[styles.meta, doneToday && styles.metaDone]}>
                    Scheduled {item.scheduled}
                  </Text>
                )}
                {item.description ? (
                  <Text
                    style={[
                      styles.description,
                      doneToday && styles.descriptionDone,
                    ]}
                  >
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <View style={styles.habitActionRail}>
                <TouchableOpacity
                  testID={`habit-done-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
                  style={[
                    styles.doneButton,
                    doneToday && styles.doneButtonComplete,
                    pending && styles.actionButtonDisabled,
                  ]}
                  onPress={() => handleCompleteHabit(item)}
                  disabled={pending}
                >
                  {completing ? (
                    <ActivityIndicator size="small" color="#F1F5E8" />
                  ) : (
                    <Text style={styles.doneText}>
                      {doneToday ? "TODO" : "Done"}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`habit-menu-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
                  accessibilityLabel="Habit actions"
                  style={[styles.menuButton, pending && styles.actionButtonDisabled]}
                  onPress={() => setMenuHabit(item)}
                  disabled={pending}
                >
                  <Text style={styles.menuButtonText}>⋯</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            {!hasHydratedConfig || agendaQuery.isPending ? (
              <ActivityIndicator color="#DDE5D4" />
            ) : null}
            <Text style={styles.emptyText}>
              {!hasHydratedConfig || agendaQuery.isPending
                ? "Loading habits from your Org files..."
                : "Habits will appear after parsing org-habit entries."}
            </Text>
          </View>
        )}
      />

      <Modal
        visible={Boolean(menuHabit)}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuHabit(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuHabit(null)}>
          <Pressable style={styles.menuSheet}>
            <Text style={styles.menuTitle}>{menuHabit?.title ?? "Habit actions"}</Text>
            <TouchableOpacity
              testID="habit-menu-delete"
              style={[
                styles.deleteButton,
                menuHabit &&
                  pendingHabitKey === `delete:${habitKey(menuHabit)}` &&
                  styles.actionButtonDisabled,
              ]}
              onPress={() => menuHabit && handleDeleteHabit(menuHabit)}
              disabled={
                !menuHabit || pendingHabitKey === `delete:${habitKey(menuHabit)}`
              }
            >
              {menuHabit && pendingHabitKey === `delete:${habitKey(menuHabit)}` ? (
                <ActivityIndicator size="small" color="#F0C0B0" />
              ) : (
                <Text style={styles.deleteText}>Delete habit</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setMenuHabit(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
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
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#3D4638",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "stretch",
  },
  cardDoneToday: {
    borderColor: "#4D5B3B",
    backgroundColor: "#0A0F08",
    opacity: 0.9,
  },
  cardContent: {
    flex: 1,
    padding: 10,
  },
  cardHeader: {
    gap: 4,
  },
  titleButton: {
    flex: 1,
  },
  title: {
    color: "#F2F5EC",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
  },
  titleDone: {
    color: "#8F978A",
    textDecorationLine: "line-through",
    textDecorationColor: "#8F978A",
  },
  streak: {
    color: "#9BA394",
    fontSize: 11,
    lineHeight: 15,
  },
  streakDone: {
    color: "#DCE8B8",
    fontWeight: "800",
  },
  meta: {
    color: "#9BA394",
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
  },
  metaDone: {
    color: "#7F877A",
  },
  description: {
    marginTop: 4,
    color: "#C6CDBF",
    fontSize: 11,
    lineHeight: 14,
  },
  descriptionDone: {
    color: "#828A7D",
  },
  habitActionRail: {
    flexDirection: "row",
    alignSelf: "stretch",
    borderLeftWidth: 1,
    borderLeftColor: "#2E3A2B",
  },
  doneButton: {
    backgroundColor: "#394A23",
    width: 72,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  doneButtonComplete: {
    backgroundColor: "#54652D",
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  doneText: {
    color: "#F1F5E8",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  menuButton: {
    width: 38,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111A10",
    borderLeftWidth: 1,
    borderLeftColor: "#2E3A2B",
  },
  menuButtonText: {
    color: "#DDE5D4",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "900",
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "flex-end",
    padding: 16,
  },
  menuSheet: {
    backgroundColor: "#0D160C",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3D4638",
    padding: 12,
    gap: 10,
  },
  menuTitle: {
    color: "#F2F5EC",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  deleteButton: {
    backgroundColor: "#352019",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#643526",
  },
  deleteText: {
    color: "#F0C0B0",
    fontWeight: "900",
    fontSize: 13,
  },
  cancelButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#172015",
  },
  cancelText: {
    color: "#DDE5D4",
    fontWeight: "800",
    fontSize: 13,
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
