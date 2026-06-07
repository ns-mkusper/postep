import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addHabitAsync,
  deleteHabitAsync,
} from "@postep/bridge";
import { useBridgeConfig } from "../../store/orgConfig";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import { loadAgendaSnapshotForConfig } from "../../lib/agendaSources";

export default function HabitsScreen() {
  const config = useBridgeConfig();
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
      config.roots.length === 0
        ? Promise.resolve({ items: [], habits: [] })
        : loadAgendaSnapshotForConfig(config),
  });

  useBridgeEvent("agendaChanged", () => agendaQuery.refetch());
  useBridgeEvent("rootsChanged", () => agendaQuery.refetch());

  const habits = useMemo(
    () => agendaQuery.data?.habits ?? [],
    [agendaQuery.data?.habits],
  );

  const handleAddHabit = async () => {
    if (config.roots.length === 0 || !title.trim()) {
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

  const handleDeleteHabit = async (habitTitle: string) => {
    if (config.roots.length === 0) {
      return;
    }
    const snapshot = await deleteHabitAsync({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: `${config.roots[0]}/sample-01.org`,
      title: habitTitle.replace(/^TODO\s+/, ""),
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
        <TouchableOpacity
          testID="habit-add-button"
          style={styles.addButton}
          onPress={handleAddHabit}
        >
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
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.streak}>{item.last_repeat ?? "—"}</Text>
            </View>
            <Text style={styles.description}>{item.description}</Text>
            <TouchableOpacity
              testID={`habit-delete-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
              style={styles.deleteButton}
              onPress={() => handleDeleteHabit(item.title)}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              Habits will appear after parsing org-habit entries.
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
    padding: 16,
    backgroundColor: "#091108",
    borderBottomWidth: 1,
    borderBottomColor: "#303B2D",
  },
  editorTitle: {
    color: "#F0F4EA",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#0C150B",
    color: "#F2F5EC",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#303B2D",
    fontSize: 18,
    lineHeight: 24,
  },
  addButton: {
    backgroundColor: "#4D5F31",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 17,
  },
  list: {
    flex: 1,
    backgroundColor: "#071008",
  },
  card: {
    backgroundColor: "#091108",
    padding: 16,
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  title: {
    color: "#F2F5EC",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    flex: 1,
    paddingRight: 10,
  },
  streak: {
    color: "#9BA394",
    fontSize: 15,
    lineHeight: 22,
  },
  description: {
    marginTop: 10,
    color: "#C6CDBF",
    fontSize: 19,
    lineHeight: 27,
  },
  deleteButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    backgroundColor: "#352019",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteText: {
    color: "#F0C0B0",
    fontWeight: "800",
    fontSize: 15,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    color: "#8C9486",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "center",
  },
});
