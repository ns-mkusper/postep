import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Modal,
  Pressable,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Switch,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Platform,
  StatusBar,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type DocumentPayload,
  type DocumentRef,
  type LexicalNode,
} from "@postep/bridge";
import { LexicalDocument } from "../../components/LexicalDocument";
import { useBridgeEvent } from "../../hooks/useBridgeEvent";
import { useBridgeConfig } from "../../store/orgConfig";
import {
  createBlockViewModels,
  measureAsyncInteraction,
  measureInteraction,
  moveRawBlock,
  updateRawBlock,
  type OrgBlockViewModel,
} from "../../lib/orgLexicalModel";
import {
  listDocumentsForConfig,
  loadDocumentForConfig,
  updateDocumentForConfig,
} from "../../lib/documentSources";

type NoteLine = {
  text: string;
  checked?: boolean | null;
  kind: "heading" | "list" | "body";
  lineStart?: number;
};

type NoteMetadata = {
  todo?: string | null;
  priority?: string | null;
  scheduled?: string | null;
  deadline?: string | null;
  habit?: boolean;
  properties: Array<{ key: string; value: string }>;
};

type NotePreview = {
  doc: DocumentRef;
  title: string;
  lines: NoteLine[];
  checkedCount: number;
  tags: string[];
  metadata: NoteMetadata;
  primaryDate?: string | null;
};

type ChecklistItem = {
  id: string;
  text: string;
  checked: boolean;
  lineStart: number;
};

const PREVIEW_LOAD_CONCURRENCY = 4;
const PREVIEW_LOAD_LIMIT = 24;
const PREVIEW_LOAD_TIMEOUT_MS = 5000;
const ANDROID_STATUS_BAR_FALLBACK = 58;

function topSystemInset(insetTop: number): number {
  if (Platform.OS !== "android") {
    return insetTop;
  }
  return Math.max(
    insetTop,
    StatusBar.currentHeight ?? 0,
    ANDROID_STATUS_BAR_FALLBACK,
  );
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index], index);
      }
    }),
  );

  return results;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function loadPreviewOrSkip(
  bridgeConfig: ReturnType<typeof useBridgeConfig>,
  doc: DocumentRef,
): Promise<NotePreview | null> {
  try {
    const payload = await withTimeout(
      loadDocumentForConfig(bridgeConfig, doc.path),
      PREVIEW_LOAD_TIMEOUT_MS,
      doc.name,
    );
    return buildPreview(doc, payload);
  } catch (error) {
    console.warn("Postep preview load skipped", {
      name: doc.name,
      path: doc.path,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function cleanOrgText(text: string) {
  return text
    .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeTimestamp(text?: string | null) {
  if (!text) {
    return null;
  }
  return text
    .replace(/[<>]/g, "")
    .replace(/\s+\+\d+[dwmy]/i, "")
    .trim();
}

function isInternalParagraph(text: string) {
  return (
    /^:(LOGBOOK|END):$/i.test(text.trim()) ||
    /^State ".*" from ".*" \[/.test(text.trim())
  );
}

function textForNode(node: LexicalNode) {
  if ("text" in node) {
    return cleanOrgText(node.text);
  }
  if (node.type === "table") {
    return node.rows[0]?.join(" · ") ?? "Table";
  }
  return cleanOrgText(node.raw);
}

function listItemPreviewText(
  raw: string,
  node: Extract<LexicalNode, { type: "list_item" }>,
) {
  const lines = raw.split("\n");
  const first = lines[node.line_start] ?? "";
  const indent = first.match(/^\s*/)?.[0].length ?? 0;
  const body = [node.text];
  for (let idx = node.line_start + 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    const nextIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) {
      break;
    }
    if (
      /^\*+\s+/.test(trimmed) ||
      /^(SCHEDULED|DEADLINE|CLOSED):/.test(trimmed) ||
      /^#\+/.test(trimmed) ||
      /^:[A-Z0-9_+-]+:$/i.test(trimmed)
    ) {
      break;
    }
    if (/^([-+]|\d+[.)])\s+/.test(trimmed) && nextIndent <= indent) {
      break;
    }
    body.push(trimmed.replace(/^([-+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""));
  }
  return cleanOrgText(body.join("\n"));
}

function titleFromDocument(doc: DocumentRef, nodes: LexicalNode[]) {
  const titleDirective = nodes.find(
    (node) =>
      node.type === "directive" && node.keyword.toUpperCase() === "TITLE",
  );
  if (
    titleDirective &&
    "text" in titleDirective &&
    titleDirective.text.trim()
  ) {
    return titleDirective.text.trim();
  }
  const heading = nodes.find((node) => node.type === "heading");
  if (heading && "text" in heading && heading.text.trim()) {
    return heading.text.trim();
  }
  return doc.name.replace(/\.org$/i, "");
}

function buildPreview(doc: DocumentRef, payload: DocumentPayload): NotePreview {
  const title = titleFromDocument(doc, payload.lexical);
  const firstHeading = payload.lexical.find(
    (node): node is Extract<LexicalNode, { type: "heading" }> =>
      node.type === "heading",
  );
  const planning = payload.lexical.filter(
    (node): node is Extract<LexicalNode, { type: "planning" }> =>
      node.type === "planning",
  );
  const propertyDrawer = payload.lexical.find(
    (node): node is Extract<LexicalNode, { type: "property_drawer" }> =>
      node.type === "property_drawer",
  );
  const metadata: NoteMetadata = {
    todo: firstHeading?.todo_keyword ?? null,
    priority: firstHeading?.priority ?? null,
    scheduled: humanizeTimestamp(
      planning.find((node) => node.keyword === "SCHEDULED")?.text,
    ),
    deadline: humanizeTimestamp(
      planning.find((node) => node.keyword === "DEADLINE")?.text,
    ),
    habit: Boolean(
      firstHeading?.tags.includes("habit") ||
      propertyDrawer?.properties.STYLE?.toLowerCase() === "habit",
    ),
    properties: propertyDrawer
      ? Object.entries(propertyDrawer.properties)
          .filter(([key]) =>
            ["STYLE", "LAST_REPEAT", "EFFORT"].includes(key.toUpperCase()),
          )
          .map(([key, value]) => ({ key, value }))
      : [],
  };
  const lines: NoteLine[] = payload.lexical
    .flatMap((node): NoteLine[] => {
      if (node.type === "heading") {
        const text = textForNode(node);
        return text && text !== title ? [{ text, kind: "heading" }] : [];
      }
      if (node.type === "list_item") {
        const text = listItemPreviewText(payload.raw, node);
        return text
          ? [
              {
                text,
                checked: node.checked ?? null,
                kind: "list",
                lineStart: node.line_start,
              },
            ]
          : [];
      }
      if (node.type === "paragraph") {
        const text = textForNode(node);
        return text && !isInternalParagraph(text)
          ? [{ text, kind: "body" }]
          : [];
      }
      if (node.type === "table") {
        const text = textForNode(node);
        return text ? [{ text, kind: "body" }] : [];
      }
      return [];
    })
    .slice(0, 7);
  const checkedCount = payload.lexical.filter(
    (node) => node.type === "list_item" && node.checked,
  ).length;
  const tags = Array.from(
    new Set(
      payload.lexical
        .filter(
          (node): node is Extract<LexicalNode, { type: "heading" }> =>
            node.type === "heading",
        )
        .flatMap((node) => node.tags),
    ),
  ).slice(0, 3);

  return {
    doc,
    title,
    lines,
    checkedCount,
    tags,
    metadata,
    primaryDate:
      metadata.scheduled?.slice(0, 10) ??
      metadata.deadline?.slice(0, 10) ??
      null,
  };
}

function buildFallbackPreview(doc: DocumentRef): NotePreview {
  return {
    doc,
    title: doc.name.replace(/\.org$/i, ""),
    lines: [],
    checkedCount: 0,
    tags: [],
    metadata: {
      properties: [],
    },
    primaryDate: null,
  };
}

function buildChecklistItems(
  raw: string,
  nodes: LexicalNode[],
): ChecklistItem[] {
  return nodes
    .filter(
      (node): node is Extract<LexicalNode, { type: "list_item" }> =>
        node.type === "list_item" && node.checked !== null,
    )
    .map((node) => ({
      id: `${node.line_start}:${node.text}`,
      text: listItemPreviewText(raw, node),
      checked: Boolean(node.checked),
      lineStart: node.line_start,
    }));
}

function insertChecklistItem(raw: string, text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return raw;
  }
  const lines = raw.split("\n");
  let insertAt = -1;
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    if (/^\s*[-+]\s+\[[ xX]\]/.test(lines[idx])) {
      insertAt = idx + 1;
      break;
    }
  }
  if (insertAt < 0) {
    const firstHeading = lines.findIndex((line) => /^\*+\s+/.test(line));
    insertAt = firstHeading >= 0 ? firstHeading + 1 : lines.length;
  }
  lines.splice(insertAt, 0, `- [ ] ${trimmed}`);
  return lines.join("\n");
}

function renderOrgNode(
  node: LexicalNode,
  fallback: Parameters<typeof LexicalDocument>[0]["value"],
) {
  if (node.type === "heading") {
    return (
      <View style={styles.renderedHeading}>
        <View style={styles.metadataRow}>
          {node.todo_keyword && (
            <Text style={styles.todoChip}>{node.todo_keyword}</Text>
          )}
          {node.priority && (
            <Text style={styles.priorityChip}>Priority {node.priority}</Text>
          )}
          {node.tags.includes("habit") && (
            <Text style={styles.habitChip}>Habit</Text>
          )}
          {node.tags.map((tag) => (
            <Text key={tag} style={styles.tagChip}>
              #{tag}
            </Text>
          ))}
        </View>
        <Text
          style={[
            styles.renderedHeadingText,
            node.depth > 1 && styles.renderedSubheadingText,
          ]}
        >
          {cleanOrgText(node.text)}
        </Text>
      </View>
    );
  }

  if (node.type === "planning") {
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>{node.keyword}</Text>
        <Text style={styles.metadataValue}>
          {humanizeTimestamp(node.text) ?? cleanOrgText(node.text)}
        </Text>
      </View>
    );
  }

  if (node.type === "property_drawer") {
    const entries = Object.entries(node.properties);
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>Properties</Text>
        <View style={styles.propertyGrid}>
          {entries.map(([key, value]) => (
            <View key={key} style={styles.propertyPill}>
              <Text style={styles.propertyKey}>{key}</Text>
              <Text style={styles.propertyValue}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (node.type === "drawer") {
    const entryCount = node.text
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>{node.name}</Text>
        <Text style={styles.metadataValue}>
          {node.collapsed
            ? `${entryCount} entr${entryCount === 1 ? "y" : "ies"}`
            : cleanOrgText(node.text)}
        </Text>
      </View>
    );
  }

  if (node.type === "paragraph") {
    return <Text style={styles.paragraphText}>{cleanOrgText(node.text)}</Text>;
  }

  if (node.type === "list_item") {
    return (
      <View style={styles.renderedListItem}>
        <View
          style={[styles.checkbox, node.checked && styles.checkboxChecked]}
        />
        <Text
          style={[
            styles.paragraphText,
            node.checked && styles.previewCheckedText,
          ]}
        >
          {cleanOrgText(node.text)}
        </Text>
      </View>
    );
  }

  if (node.type === "table") {
    return (
      <View style={styles.metadataCard}>
        {node.rows.map((row, index) => (
          <Text key={`${row.join(":")}:${index}`} style={styles.monoText}>
            {row.join("   ")}
          </Text>
        ))}
      </View>
    );
  }

  if (node.type === "code_block") {
    return (
      <View style={styles.codeCard}>
        {node.language && (
          <Text style={styles.metadataLabel}>{node.language}</Text>
        )}
        <Text style={styles.codeText}>{node.text}</Text>
      </View>
    );
  }

  if (node.type === "directive") {
    if (["TITLE", "CATEGORY"].includes(node.keyword.toUpperCase())) {
      return (
        <View style={styles.metadataCard}>
          <Text style={styles.metadataLabel}>{node.keyword}</Text>
          <Text style={styles.metadataValue}>{cleanOrgText(node.text)}</Text>
        </View>
      );
    }
  }

  return <LexicalDocument value={fallback} />;
}

function blockLabel(node: LexicalNode) {
  if (node.type === "heading") {
    return "Note";
  }
  if (node.type === "planning") {
    return node.keyword === "DEADLINE" ? "Due date" : "Schedule";
  }
  if (node.type === "property_drawer") {
    return "Metadata";
  }
  if (node.type === "drawer") {
    return node.name === "LOGBOOK" ? "History" : node.name;
  }
  return node.type.replace("_", " ");
}

function isVisibleDocumentBlock(block: OrgBlockViewModel) {
  if (
    block.node.type === "directive" &&
    ["TITLE", "CATEGORY"].includes(block.node.keyword.toUpperCase())
  ) {
    return false;
  }
  return true;
}

function toggleRawCheckbox(raw: string, lineStart: number): string {
  const lines = raw.split("\n");
  const line = lines[lineStart];
  if (!line) {
    return raw;
  }
  if (/^(\s*[-+]\s+)\[ \]/.test(line)) {
    lines[lineStart] = line.replace(/^(\s*[-+]\s+)\[ \]/, "$1[X]");
    return lines.join("\n");
  }
  if (/^(\s*[-+]\s+)\[[xX]\]/.test(line)) {
    lines[lineStart] = line.replace(/^(\s*[-+]\s+)\[[xX]\]/, "$1[ ]");
    return lines.join("\n");
  }
  return raw;
}

export default function LibraryScreen() {
  const queryClient = useQueryClient();
  const bridgeConfig = useBridgeConfig();
  const insets = useSafeAreaInsets();
  const headerPaddingTop = topSystemInset(insets.top) + 8;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(false);
  const [showDocument, setShowDocument] = useState(true);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftRaw, setDraftRaw] = useState("");
  const [newChecklistText, setNewChecklistText] = useState("");
  const [showCheckedItems, setShowCheckedItems] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [interactionStatus, setInteractionStatus] = useState<string | null>(
    null,
  );
  const { width } = useWindowDimensions();
  const numColumns = width >= 360 ? 2 : 1;
  const hasConfiguredRoots =
    bridgeConfig.roots.length > 0 || (bridgeConfig.roamRoots?.length ?? 0) > 0;

  const documentsQuery = useQuery({
    queryKey: [
      "documents",
      bridgeConfig.roots.join(":"),
      bridgeConfig.roamRoots?.join(":") ?? "",
    ],
    queryFn: () => listDocumentsForConfig(bridgeConfig),
  });

  useEffect(() => {
    if (documentsQuery.data && selectedPath) {
      const stillExists = documentsQuery.data.some(
        (doc) => doc.path === selectedPath,
      );
      if (!stillExists) {
        setSelectedPath(null);
      }
    }
  }, [documentsQuery.data, selectedPath]);

  const previewsQuery = useQuery({
    queryKey: [
      "document-previews",
      documentsQuery.data?.map((doc) => doc.path).join(":"),
      bridgeConfig.roots.join(":"),
      bridgeConfig.roamRoots?.join(":") ?? "",
    ],
    enabled: Boolean(documentsQuery.data) && hasConfiguredRoots,
    queryFn: () =>
      measureAsyncInteraction("noteGrid", async () => {
        const documents = (documentsQuery.data ?? []).slice(0, PREVIEW_LOAD_LIMIT);
        const previews = await mapConcurrent(
          documents,
          PREVIEW_LOAD_CONCURRENCY,
          (doc) => loadPreviewOrSkip(bridgeConfig, doc),
        );
        return previews
          .filter((preview): preview is NotePreview => preview !== null)
          .sort((left, right) =>
            (left.primaryDate ?? "9999-12-31").localeCompare(
              right.primaryDate ?? "9999-12-31",
            ),
          );
      }),
  });

  const previewByPath = useMemo(
    () =>
      new Map(
        (previewsQuery.data?.value ?? []).map((preview) => [
          preview.doc.path,
          preview,
        ]),
      ),
    [previewsQuery.data?.value],
  );

  const noteGrid = useMemo(
    () => ({
      value: (documentsQuery.data ?? []).map(
        (doc) => previewByPath.get(doc.path) ?? buildFallbackPreview(doc),
      ),
      metric: previewsQuery.data?.metric ?? { elapsedMs: 0 },
    }),
    [documentsQuery.data, previewByPath, previewsQuery.data?.metric],
  );

  const visibleNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return noteGrid.value;
    }
    return noteGrid.value.filter((note) => {
      const searchable = [
        note.title,
        note.doc.name,
        ...note.lines.map((line) => line.text),
        ...note.tags,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [noteGrid.value, searchQuery]);

  const documentQuery = useQuery({
    queryKey: [
      "document",
      selectedPath,
      bridgeConfig.roots.join(":"),
      bridgeConfig.roamRoots?.join(":") ?? "",
    ],
    enabled: Boolean(selectedPath) && hasConfiguredRoots,
    queryFn: () => loadDocumentForConfig(bridgeConfig, selectedPath!),
  });

  const blockModel = useMemo(
    () =>
      measureInteraction("lexicalProjection", () =>
        createBlockViewModels(
          documentQuery.data?.lexical ?? [],
          documentQuery.data?.raw ?? "",
          {
            outlineOnly,
            readerMode,
          },
        ),
      ),
    [
      documentQuery.data?.raw,
      documentQuery.data?.lexical,
      outlineOnly,
      readerMode,
    ],
  );
  const blocks = blockModel.value;
  const visibleBlocks = useMemo(
    () => blocks.filter(isVisibleDocumentBlock),
    [blocks],
  );
  const selectedName =
    documentsQuery.data?.find((doc) => doc.path === selectedPath)?.name ??
    "Org note";
  const checklistItems = useMemo(
    () =>
      documentQuery.data
        ? buildChecklistItems(
            documentQuery.data.raw,
            documentQuery.data.lexical,
          )
        : [],
    [documentQuery.data?.raw, documentQuery.data?.lexical],
  );
  const uncheckedItems = checklistItems.filter((item) => !item.checked);
  const checkedItems = checklistItems.filter((item) => item.checked);

  useEffect(() => {
    const metric = selectedPath
      ? blockModel.metric.elapsedMs
      : noteGrid.metric.elapsedMs;
    const label = selectedPath ? "Render model" : "Card grid";
    setInteractionStatus(`${label} ${metric.toFixed(2)}ms`);
  }, [blockModel.metric.elapsedMs, noteGrid.metric.elapsedMs, selectedPath]);

  const onRefreshDocuments = () => {
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "documents",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "document-previews",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "document",
    });
  };

  useBridgeEvent("documentsChanged", onRefreshDocuments);
  useBridgeEvent("rootsChanged", onRefreshDocuments);

  const persistRaw = async (raw: string, label: string) => {
    if (!selectedPath || !hasConfiguredRoots) {
      return;
    }
    const path = selectedPath;
    const { value: payload, metric } = await measureAsyncInteraction(
      label,
      () =>
        updateDocumentForConfig({
          roots: bridgeConfig.roots,
          roamRoots: bridgeConfig.roamRoots,
          path,
          raw,
        }),
    );
    queryClient.setQueryData(
      [
        "document",
        path,
        bridgeConfig.roots.join(":"),
        bridgeConfig.roamRoots?.join(":") ?? "",
      ],
      payload,
    );
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "agenda",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "documents",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "document-previews",
    });
    setInteractionStatus(`${label} ${metric.elapsedMs.toFixed(2)}ms`);
  };

  const startEditing = (block: OrgBlockViewModel) => {
    setEditingBlockId(block.id);
    setDraftRaw(block.rawText);
  };

  const saveBlockEdit = (block: OrgBlockViewModel) => {
    const raw = documentQuery.data?.raw ?? "";
    const nextRaw = updateRawBlock(raw, block.node, draftRaw);
    void persistRaw(nextRaw, "blockEdit");
    setEditingBlockId(null);
    setDraftRaw("");
  };

  const moveBlock = (block: OrgBlockViewModel, direction: -1 | 1) => {
    const raw = documentQuery.data?.raw ?? "";
    const { value: nextRaw, metric } = measureInteraction("blockMove", () =>
      moveRawBlock(raw, block.node, direction),
    );
    setInteractionStatus(`blockMove ${metric.elapsedMs.toFixed(2)}ms`);
    if (nextRaw !== raw) {
      void persistRaw(nextRaw, "persistMove");
    }
  };

  const openAppMenu = () => setIsAppMenuOpen(true);
  const closeAppMenu = () => setIsAppMenuOpen(false);
  const navigateFromMenu = (
    href: "/library" | "/agenda" | "/roam" | "/habits" | "/settings",
  ) => {
    setIsAppMenuOpen(false);
    router.push(href);
  };

  const toggleChecklistItem = async (path: string, lineStart?: number) => {
    if (lineStart === undefined || !hasConfiguredRoots) {
      return;
    }
    const payload = await loadDocumentForConfig(bridgeConfig, path);
    const nextRaw = toggleRawCheckbox(payload.raw, lineStart);
    if (nextRaw === payload.raw) {
      return;
    }
    const { value: nextPayload, metric } = await measureAsyncInteraction(
      "checklistToggle",
      () =>
        updateDocumentForConfig({
          roots: bridgeConfig.roots,
          roamRoots: bridgeConfig.roamRoots,
          path,
          raw: nextRaw,
        }),
    );
    queryClient.setQueryData(
      [
        "document",
        path,
        bridgeConfig.roots.join(":"),
        bridgeConfig.roamRoots?.join(":") ?? "",
      ],
      nextPayload,
    );
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "documents",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "document-previews",
    });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "agenda",
    });
    setInteractionStatus(`checklistToggle ${metric.elapsedMs.toFixed(2)}ms`);
  };

  const handleChecklistPress = (
    event: GestureResponderEvent,
    path: string,
    lineStart?: number,
  ) => {
    event.stopPropagation();
    void toggleChecklistItem(path, lineStart);
  };

  const addChecklistItem = () => {
    if (!selectedPath || !documentQuery.data || !newChecklistText.trim()) {
      return;
    }
    const nextRaw = insertChecklistItem(
      documentQuery.data.raw,
      newChecklistText,
    );
    void persistRaw(nextRaw, "checklistAdd");
    setNewChecklistText("");
  };

  const renderChecklistRow = (item: ChecklistItem) => (
    <View key={item.id} style={styles.listEditorRow}>
      <Text style={styles.dragHandle}>⠿</Text>
      <TouchableOpacity
        testID={`detail-checkbox-${item.lineStart}`}
        onPress={() =>
          selectedPath && void toggleChecklistItem(selectedPath, item.lineStart)
        }
        style={[
          styles.detailCheckbox,
          item.checked && styles.detailCheckboxChecked,
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
      >
        {item.checked && <Text style={styles.detailCheckmark}>✓</Text>}
      </TouchableOpacity>
      <Text
        style={[
          styles.listEditorText,
          item.checked && styles.listEditorCheckedText,
        ]}
      >
        {item.text}
      </Text>
    </View>
  );

  const renderChecklistEditor = () => (
    <View style={styles.listEditorScreen}>
      <View style={styles.listEditorTopBar}>
        <TouchableOpacity
          onPress={() => setSelectedPath(null)}
          style={styles.iconButton}
          testID="back-to-notes"
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.listEditorActions}>
          <TouchableOpacity style={styles.roundIconButton}>
            <Text style={styles.roundIconText}>👤＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.roundIconButton}>
            <Text style={styles.roundIconText}>󰂚</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.roundIconButton}>
            <Text style={styles.roundIconText}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView
        testID="document-scroll"
        style={styles.listEditorScroll}
        contentContainerStyle={styles.listEditorContent}
      >
        <Text style={styles.listEditorTitle}>
          {titleFromDocument(
            { path: selectedPath ?? "", name: selectedName },
            documentQuery.data?.lexical ?? [],
          )}
        </Text>
        {uncheckedItems.map(renderChecklistRow)}
        <View style={styles.addListRow}>
          <Text style={styles.addListIcon}>＋</Text>
          <TextInput
            testID="new-list-item-input"
            style={styles.addListInput}
            value={newChecklistText}
            onChangeText={setNewChecklistText}
            onSubmitEditing={addChecklistItem}
            placeholder="List item"
            placeholderTextColor="#AEB4A8"
            returnKeyType="done"
          />
        </View>
        {checkedItems.length > 0 && (
          <View style={styles.checkedSection}>
            <TouchableOpacity
              style={styles.checkedHeader}
              onPress={() => setShowCheckedItems((value) => !value)}
            >
              <Text style={styles.checkedChevron}>
                {showCheckedItems ? "⌄" : "›"}
              </Text>
              <Text style={styles.checkedHeaderText}>
                {checkedItems.length} Checked item
                {checkedItems.length === 1 ? "" : "s"}
              </Text>
            </TouchableOpacity>
            {showCheckedItems && checkedItems.map(renderChecklistRow)}
          </View>
        )}
      </ScrollView>
      <View style={styles.bottomToolbar}>
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={styles.bottomToolText}>⊞</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={styles.bottomToolText}>◉</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={styles.bottomToolText}>A</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={styles.bottomToolText}>↶</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={[styles.bottomToolText, { opacity: 0.4 }]}>↷</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bottomTool}>
          <Text style={styles.bottomToolText}>⋮</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const openNote = (path: string) => setSelectedPath(path);

  const renderPreviewLine = (
    item: NotePreview,
    line: NoteLine,
    index: number,
  ) => {
    if (line.kind === "list") {
      return (
        <View key={`${line.text}:${index}`} style={styles.previewLine}>
          <TouchableOpacity
            testID={`note-checkbox-${item.doc.name}-${line.lineStart ?? index}`}
            onPress={(event) =>
              handleChecklistPress(event, item.doc.path, line.lineStart)
            }
            style={[styles.checkbox, line.checked && styles.checkboxChecked]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(line.checked) }}
          />
          <TouchableOpacity
            style={styles.previewTextButton}
            onPress={() => openNote(item.doc.path)}
            activeOpacity={0.75}
          >
            <Text
              numberOfLines={index > 3 ? 1 : 3}
              style={[
                styles.previewText,
                line.checked && styles.previewCheckedText,
              ]}
            >
              {line.text}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        key={`${line.text}:${index}`}
        style={[
          styles.previewLine,
          line.kind === "heading" && styles.previewHeadingLine,
        ]}
        onPress={() => openNote(item.doc.path)}
        activeOpacity={0.75}
      >
        <View
          style={
            line.kind === "heading"
              ? styles.previewHeadingSpacer
              : styles.previewBullet
          }
        />
        <Text
          numberOfLines={index > 3 ? 1 : 2}
          style={[
            styles.previewText,
            line.kind === "heading" && styles.previewHeadingText,
          ]}
        >
          {line.text}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderNoteCard = ({ item }: { item: NotePreview }) => (
    <View style={styles.noteCard} testID={`document-card-${item.doc.name}`}>
      <TouchableOpacity
        onPress={() => openNote(item.doc.path)}
        activeOpacity={0.78}
      >
        <Text style={styles.noteTitle}>{item.title}</Text>
        <View style={styles.metadataRow}>
          {item.metadata.todo && (
            <Text style={styles.todoChip}>{item.metadata.todo}</Text>
          )}
          {item.metadata.priority && (
            <Text style={styles.priorityChip}>#{item.metadata.priority}</Text>
          )}
          {item.metadata.habit && <Text style={styles.habitChip}>Habit</Text>}
          {item.metadata.scheduled && (
            <Text style={styles.metaChip}>
              Scheduled {item.metadata.scheduled}
            </Text>
          )}
          {item.metadata.deadline && !item.metadata.scheduled && (
            <Text style={styles.deadlineChip}>
              Due {item.metadata.deadline}
            </Text>
          )}
        </View>
      </TouchableOpacity>
      <View style={styles.previewLines}>
        {item.lines.map((line, index) => renderPreviewLine(item, line, index))}
      </View>
      {item.checkedCount > 0 && (
        <Text style={styles.checkedSummary}>
          + {item.checkedCount} checked items
        </Text>
      )}
      {item.tags.length > 0 && (
        <TouchableOpacity
          style={styles.tagRow}
          onPress={() => openNote(item.doc.path)}
          activeOpacity={0.78}
        >
          {item.tags.map((tag) => (
            <Text key={tag} style={styles.tagChip}>
              #{tag}
            </Text>
          ))}
        </TouchableOpacity>
      )}
    </View>
  );

  const drawerWidth = Math.min(width * 0.84, 360);

  return (
    <View
      style={[
        styles.container,
        { paddingLeft: insets.left, paddingRight: insets.right },
      ]}
      testID="documents-screen"
    >
      <Modal
        visible={isAppMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAppMenu}
        testID="navigation-drawer"
      >
        <View style={styles.drawerLayer}>
          <Pressable
            style={styles.drawerScrim}
            onPress={closeAppMenu}
            testID="navigation-drawer-scrim"
          />
          <View
            style={[
              styles.navDrawer,
              { paddingTop: headerPaddingTop, width: drawerWidth },
            ]}
          >
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Postep</Text>
              <TouchableOpacity
                onPress={closeAppMenu}
                style={styles.drawerCloseButton}
                testID="navigation-drawer-close"
                accessibilityLabel="Close navigation drawer"
              >
                <Text style={styles.drawerCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => navigateFromMenu("/library")}
              testID="drawer-item-notes"
            >
              <Text style={styles.drawerItemText}>📝 Notes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => navigateFromMenu("/agenda")}
              testID="drawer-item-agenda"
            >
              <Text style={styles.drawerItemText}>📅 Agenda</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => navigateFromMenu("/roam")}
              testID="drawer-item-roam"
            >
              <Text style={styles.drawerItemText}>🕸 Org-roam</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => navigateFromMenu("/habits")}
              testID="drawer-item-habits"
            >
              <Text style={styles.drawerItemText}>🔁 Habits</Text>
            </TouchableOpacity>
            <View style={styles.drawerDivider} />
            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => navigateFromMenu("/settings")}
              testID="drawer-item-settings"
            >
              <Text style={styles.drawerItemText}>⚙ Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <View style={[styles.postepHeader, { paddingTop: headerPaddingTop }]}>
        <TouchableOpacity
          testID="hamburger-menu"
          onPress={openAppMenu}
          style={styles.iconButton}
          accessibilityLabel="Open app menu"
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.searchPill}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            testID="library-search-input"
            style={styles.searchInput}
            placeholder="Search notes"
            placeholderTextColor="#B9C0B2"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              if (selectedPath) {
                setSelectedPath(null);
              }
            }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              testID="clear-library-search"
            >
              <Text style={styles.searchIcon}>×</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.avatarButton}
          onPress={() => router.push("/settings")}
          testID="profile-button"
          accessibilityLabel="Open settings"
        >
          <Text style={styles.avatarText}>P</Text>
        </TouchableOpacity>
      </View>

      {!selectedPath ? (
        <View style={styles.gridScreen}>
          <View style={styles.gridMetaRow}>
            <Text style={styles.gridMeta} testID="org-library-title">
              Local Org
            </Text>
            <View style={styles.gridMetaDetails}>
              <Text style={styles.noteCountText}>
                {documentsQuery.data?.length ?? 0} notes
              </Text>
              {interactionStatus && (
                <Text style={styles.latencyText}>{interactionStatus}</Text>
              )}
            </View>
          </View>
          <FlatList
            key={`notes-${numColumns}`}
            testID="document-chip-list"
            data={visibleNotes}
            numColumns={numColumns}
            keyExtractor={(item) => item.doc.path}
            columnWrapperStyle={
              numColumns > 1 ? styles.columnWrapper : undefined
            }
            contentContainerStyle={styles.noteGrid}
            refreshing={documentsQuery.isFetching || previewsQuery.isFetching}
            onRefresh={onRefreshDocuments}
            ListHeaderComponent={() =>
              hasConfiguredRoots &&
              (documentsQuery.isFetching || previewsQuery.isFetching) ? (
                <View style={styles.loadingSourceBanner}>
                  <ActivityIndicator color="#AFC0FF" />
                  <Text style={styles.loadingSourceText}>Loading notes…</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={() => (
              <View style={styles.emptyDocs}>
                {hasConfiguredRoots &&
                (documentsQuery.isFetching || previewsQuery.isFetching) ? null : (
                  <Text style={styles.emptyDocsText}>
                    {searchQuery.trim()
                      ? "No notes match that search."
                      : "Add an Org root from the menu to see notes."}
                  </Text>
                )}
              </View>
            )}
            renderItem={renderNoteCard}
          />
          <TouchableOpacity
            testID="capture-fab"
            style={styles.fab}
            onPress={() => router.push("/capture")}
          >
            <Text style={styles.fabText}>＋</Text>
          </TouchableOpacity>
        </View>
      ) : checklistItems.length > 0 && documentQuery.data ? (
        renderChecklistEditor()
      ) : (
        <View style={styles.editorScreen}>
          <View style={styles.documentTopBar}>
            <TouchableOpacity
              onPress={() => setSelectedPath(null)}
              style={styles.backButton}
              testID="back-to-notes"
            >
              <Text style={styles.backButtonText}>‹ Notes</Text>
            </TouchableOpacity>
            <View style={styles.editorTitleBlock}>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {selectedName}
              </Text>
              {interactionStatus && (
                <Text style={styles.latencyText}>{interactionStatus}</Text>
              )}
            </View>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Reader</Text>
              <Switch value={readerMode} onValueChange={setReaderMode} />
            </View>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Outline</Text>
              <Switch value={outlineOnly} onValueChange={setOutlineOnly} />
            </View>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowDocument((v) => !v)}
            >
              <Text style={styles.actionButtonText}>
                {showDocument ? "Hide" : "Show"}
              </Text>
            </TouchableOpacity>
          </View>

          {showDocument && (
            <FlatList
              testID="document-scroll"
              style={styles.documentScroll}
              data={visibleBlocks}
              keyExtractor={(block) => block.id}
              contentContainerStyle={{ paddingBottom: 48 }}
              ListHeaderComponent={() =>
                documentQuery.isFetching ? (
                  <ActivityIndicator
                    style={{ marginVertical: 24 }}
                    color="#AFC0FF"
                  />
                ) : null
              }
              ListEmptyComponent={() =>
                !documentQuery.isFetching &&
                (!documentQuery.data || blocks.length === 0) ? (
                  <Text style={styles.emptyDocument}>
                    Select an Org file to view its contents.
                  </Text>
                ) : null
              }
              renderItem={({ item: block }) => {
                const isEditing = editingBlockId === block.id;
                return (
                  <View
                    testID={`org-block-card-${block.node.type}-${block.node.line_start}`}
                    style={[
                      styles.blockCard,
                      block.node.type === "heading" && styles.headingCard,
                    ]}
                  >
                    <View style={styles.blockToolbar}>
                      <Text style={styles.blockType}>
                        {blockLabel(block.node)}
                      </Text>
                      <View style={styles.blockActions}>
                        <TouchableOpacity
                          testID={`block-move-up-${block.node.line_start}`}
                          onPress={() => moveBlock(block, -1)}
                          style={styles.smallAction}
                        >
                          <Text style={styles.smallActionText}>↑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          testID={`block-move-down-${block.node.line_start}`}
                          onPress={() => moveBlock(block, 1)}
                          style={styles.smallAction}
                        >
                          <Text style={styles.smallActionText}>↓</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          testID={`block-edit-${block.node.line_start}`}
                          onPress={() => startEditing(block)}
                          style={styles.smallAction}
                        >
                          <Text style={styles.smallActionText}>Edit</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {isEditing ? (
                      <View>
                        <TextInput
                          testID="block-editor"
                          style={styles.blockEditor}
                          value={draftRaw}
                          onChangeText={setDraftRaw}
                          multiline
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <View style={styles.editActions}>
                          <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={() => setEditingBlockId(null)}
                          >
                            <Text style={styles.cancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            testID="block-save"
                            style={styles.saveButton}
                            onPress={() => saveBlockEdit(block)}
                          >
                            <Text style={styles.saveText}>Save</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      renderOrgNode(block.node, block.projection)
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071008" },
  drawerLayer: {
    flex: 1,
    flexDirection: "row",
  },
  drawerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.42)",
  },
  navDrawer: {
    height: "100%",
    backgroundColor: "#071008",
    borderRightWidth: 1,
    borderRightColor: "#303B2D",
    paddingHorizontal: 14,
    paddingBottom: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 12,
  },
  drawerHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  drawerTitle: {
    color: "#F2F5EC",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },
  drawerCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111A10",
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  drawerCloseText: {
    color: "#F2F5EC",
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
  },
  drawerItem: {
    minHeight: 50,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  drawerItemText: {
    color: "#E4EADF",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "800",
  },
  drawerDivider: {
    height: 1,
    backgroundColor: "#303B2D",
    marginVertical: 8,
  },
  postepHeader: {
    paddingTop: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#071008",
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  menuIcon: { color: "#DCE2D3", fontSize: 26, lineHeight: 30 },
  searchPill: {
    flex: 1,
    minHeight: 46,
    borderRadius: 24,
    backgroundColor: "#152014",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: "#F2F5EC",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "500",
    paddingVertical: 0,
    minWidth: 0,
  },
  searchIcon: { color: "#B9C0B2", fontSize: 21, fontWeight: "700" },
  avatarButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#3A4536",
    backgroundColor: "#111A10",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#E5EBDD", fontWeight: "800", fontSize: 18 },
  gridScreen: { flex: 1 },
  gridMetaRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gridMeta: {
    color: "#F0F4EA",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  gridMetaDetails: { alignItems: "flex-end", gap: 2 },
  noteCountText: { color: "#9BA394", fontSize: 15, fontWeight: "700" },
  latencyText: { color: "#747B6F", fontSize: 11 },
  noteGrid: { paddingHorizontal: 10, paddingBottom: 118, paddingTop: 2 },
  loadingSourceBanner: {
    marginHorizontal: 6,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#303B2D",
    backgroundColor: "#111A10",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingSourceText: { color: "#DDE5D4", fontSize: 15, fontWeight: "700" },
  columnWrapper: { gap: 10, alignItems: "flex-start" },
  noteCard: {
    flex: 1,
    backgroundColor: "#091108",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#3D4638",
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 10,
    minHeight: 150,
  },
  noteTitle: {
    color: "#F2F5EC",
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "800",
    marginBottom: 10,
  },
  metadataRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
    alignItems: "center",
  },
  todoChip: {
    color: "#F1F5E8",
    backgroundColor: "#394A23",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
  },
  priorityChip: {
    color: "#F8D98A",
    backgroundColor: "#352C17",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
  },
  habitChip: {
    color: "#CDE8B4",
    backgroundColor: "#24371B",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
  },
  metaChip: {
    color: "#C9D1C0",
    backgroundColor: "#1E271B",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    overflow: "hidden",
  },
  deadlineChip: {
    color: "#F0C0B0",
    backgroundColor: "#352019",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
  },
  previewLines: { gap: 8 },
  previewLine: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  previewHeadingLine: { marginTop: 8 },
  previewTextButton: { flex: 1 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 3,
    borderWidth: 2.2,
    borderColor: "#929A8C",
    marginTop: 4,
  },
  previewBullet: {
    width: 20,
    height: 20,
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  previewHeadingSpacer: { width: 20, height: 20, marginTop: 4 },
  checkboxChecked: { backgroundColor: "#8E987E", borderColor: "#8E987E" },
  previewText: { flex: 1, color: "#E6EADF", fontSize: 22, lineHeight: 29 },
  previewHeadingText: { fontWeight: "700", color: "#F1F5EB" },
  previewCheckedText: { color: "#858C7F", textDecorationLine: "line-through" },
  checkedSummary: {
    color: "#9AA193",
    fontSize: 18,
    lineHeight: 24,
    marginTop: 16,
    marginLeft: 29,
  },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14 },
  tagChip: {
    color: "#CDD5C5",
    backgroundColor: "#20291D",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    fontSize: 11,
    overflow: "hidden",
  },
  emptyDocs: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyDocsText: {
    color: "#8C9486",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 24,
    bottom: 30,
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "#4D5F31",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#6E814E",
  },
  fabText: {
    color: "#F1F6E8",
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "300",
  },
  listEditorScreen: { flex: 1, backgroundColor: "#071008" },
  listEditorTopBar: {
    paddingTop: 16,
    paddingHorizontal: 14,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backArrow: {
    color: "#E6EADE",
    fontSize: 48,
    lineHeight: 54,
    fontWeight: "300",
  },
  listEditorActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  roundIconButton: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#111A10",
    borderWidth: 1,
    borderColor: "#303B2D",
    alignItems: "center",
    justifyContent: "center",
  },
  roundIconText: { color: "#C5CBBD", fontSize: 22, fontWeight: "800" },
  listEditorScroll: { flex: 1, backgroundColor: "#071008" },
  listEditorContent: { paddingHorizontal: 28, paddingBottom: 120 },
  listEditorTitle: {
    color: "#F0F4EA",
    fontSize: 42,
    lineHeight: 52,
    fontWeight: "400",
    marginBottom: 30,
    marginTop: 38,
  },
  listEditorRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 66,
    marginBottom: 10,
  },
  dragHandle: {
    color: "#A7AEA0",
    fontSize: 30,
    width: 42,
    textAlign: "center",
    marginRight: 14,
  },
  detailCheckbox: {
    width: 34,
    height: 34,
    borderRadius: 4,
    borderWidth: 3.5,
    borderColor: "#AEB6A8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 24,
  },
  detailCheckboxChecked: { backgroundColor: "#596052", borderColor: "#596052" },
  detailCheckmark: {
    color: "#EAF0E4",
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "900",
  },
  listEditorText: { flex: 1, color: "#E7EBE0", fontSize: 31, lineHeight: 41 },
  listEditorCheckedText: {
    color: "#6E746A",
    textDecorationLine: "line-through",
  },
  addListRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 70,
    marginTop: 12,
    marginBottom: 18,
    paddingLeft: 56,
  },
  addListIcon: {
    color: "#B7BDB1",
    fontSize: 38,
    lineHeight: 44,
    marginRight: 26,
  },
  addListInput: {
    flex: 1,
    color: "#E7EBE0",
    fontSize: 29,
    lineHeight: 39,
    paddingVertical: 8,
  },
  checkedSection: { marginTop: 16 },
  checkedHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    marginBottom: 12,
  },
  checkedChevron: {
    color: "#B7BDB1",
    fontSize: 38,
    width: 44,
    marginRight: 20,
  },
  checkedHeaderText: { color: "#B7BDB1", fontSize: 29, lineHeight: 38 },
  bottomToolbar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 88,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#111A10",
    borderTopWidth: 1,
    borderTopColor: "#2E3A2B",
  },
  bottomTool: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#071008",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomToolText: { color: "#D7DCD0", fontSize: 29, fontWeight: "800" },
  editorScreen: { flex: 1, backgroundColor: "#071008" },
  documentTopBar: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#2E3A2B",
    gap: 12,
  },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#1B2418",
    borderWidth: 1,
    borderColor: "#34402F",
  },
  backButtonText: { color: "#EEF3E8", fontSize: 17, fontWeight: "700" },
  editorTitleBlock: { flex: 1 },
  editorTitle: { color: "#F2F5EC", fontSize: 20, fontWeight: "800" },
  switchRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2E3A2B",
  },
  switchItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchLabel: { color: "#D8DED2", fontSize: 16 },
  actionButton: {
    backgroundColor: "#22301E",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3A4634",
  },
  actionButtonText: { color: "#F0F4E8", fontWeight: "700", fontSize: 15 },
  documentScroll: { flex: 1, backgroundColor: "#071008" },
  blocksContainer: { padding: 10 },
  blockCard: {
    backgroundColor: "#091108",
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: "#3D4638",
  },
  headingCard: { borderColor: "#566047", backgroundColor: "#0A1309" },
  renderedHeading: { paddingVertical: 4 },
  renderedHeadingText: {
    color: "#F4F7EC",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  renderedSubheadingText: { fontSize: 24, lineHeight: 31 },
  metadataCard: {
    backgroundColor: "#111A10",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  metadataLabel: {
    color: "#A1AA99",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  metadataValue: { color: "#E4EADF", fontSize: 17, lineHeight: 24 },
  propertyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  propertyPill: {
    backgroundColor: "#1B2418",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#34402F",
  },
  propertyKey: {
    color: "#A1AA99",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  propertyValue: { color: "#F0F4E8", fontSize: 14, marginTop: 2 },
  paragraphText: { color: "#E4EADF", fontSize: 20, lineHeight: 28 },
  renderedListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 4,
  },
  monoText: {
    color: "#DDE5D4",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "monospace",
  },
  codeCard: {
    backgroundColor: "#050905",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#263323",
  },
  codeText: {
    color: "#BDE7B6",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "monospace",
  },
  blockToolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  blockType: { color: "#8F9888", fontSize: 11, textTransform: "uppercase" },
  blockActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  smallAction: {
    backgroundColor: "#1B2418",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#34402F",
  },
  smallActionText: { color: "#DDE5D4", fontSize: 12, fontWeight: "600" },
  blockEditor: {
    minHeight: 100,
    color: "#F4F7EC",
    backgroundColor: "#050905",
    borderRadius: 10,
    padding: 12,
    textAlignVertical: "top",
    fontSize: 18,
    lineHeight: 25,
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1B2418",
  },
  cancelText: { color: "#CCD5C6", fontWeight: "600" },
  saveButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#4D5F31",
  },
  saveText: { color: "#FFFFFF", fontWeight: "700" },
  emptyDocument: { color: "#8C9486", padding: 24, fontSize: 18 },
});
