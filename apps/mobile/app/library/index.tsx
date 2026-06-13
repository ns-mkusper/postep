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
  useColorScheme,
  type GestureResponderEvent,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
  createOrgLexicalDocument,
  measureAsyncInteraction,
  measureInteraction,
  moveRawBlock,
  updateRawBlock,
  type LexicalProjectionNode,
  type OrgBlockViewModel,
} from "../../lib/orgLexicalModel";
import {
  listDocumentsForConfig,
  loadDocumentForConfig,
  resolveDocumentPath,
  updateDocumentForConfig,
} from "../../lib/documentSources";
import {
  archiveHeading,
  copyHeadingBlock,
  cutHeadingBlock,
  findHeadingRange,
  headingChoices,
  insertHeading,
  moveHeading,
  pasteHeadingBlock,
  refileHeadingUnder,
  setHeadingPriority,
  setHeadingState,
  setPlanningTimestamp,
  timestampShortcut,
  toggleHeadingState,
  type HeadingPlacement,
  type MoveKind,
} from "../../lib/orgDocumentActions";

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

type DocumentDialog =
  | "overflow"
  | "paste"
  | "move"
  | "refile"
  | "schedule"
  | "deadline"
  | "priority"
  | "state"
  | "add"
  | null;

type DocumentActionIcon =
  | "cut"
  | "copy"
  | "paste"
  | "move"
  | "overflow"
  | "archive"
  | "calendar"
  | "deadline"
  | "priority"
  | "state"
  | "add";

function GraphicalActionIcon({ name }: { name: DocumentActionIcon }) {
  if (name === "cut") {
    return (
      <View style={styles.cutIcon}>
        <View style={[styles.cutBlade, styles.cutBladeLeft]} />
        <View style={[styles.cutBlade, styles.cutBladeRight]} />
        <View style={[styles.cutHandle, styles.cutHandleLeft]} />
        <View style={[styles.cutHandle, styles.cutHandleRight]} />
      </View>
    );
  }
  if (name === "copy") {
    return (
      <View style={styles.copyIcon}>
        <View style={[styles.copyIconSquare, styles.copyIconBack]} />
        <View style={[styles.copyIconSquare, styles.copyIconFront]} />
      </View>
    );
  }
  if (name === "paste") {
    return (
      <View style={styles.clipboardIcon}>
        <View style={styles.clipboardClip} />
        <View style={styles.clipboardLine} />
        <View style={[styles.clipboardLine, styles.clipboardLineShort]} />
      </View>
    );
  }
  if (name === "move") {
    return (
      <View style={styles.moveIcon}>
        <View style={[styles.moveArrowHead, styles.moveArrowUp]} />
        <View style={styles.moveStem} />
        <View style={[styles.moveArrowHead, styles.moveArrowDown]} />
      </View>
    );
  }
  if (name === "overflow") {
    return (
      <View style={styles.overflowIcon}>
        <View style={styles.overflowDot} />
        <View style={styles.overflowDot} />
        <View style={styles.overflowDot} />
      </View>
    );
  }
  if (name === "archive") {
    return (
      <View style={styles.archiveIcon}>
        <View style={styles.archiveLid} />
        <View style={styles.archiveArrowStem} />
        <View style={styles.archiveArrowHead} />
      </View>
    );
  }
  if (name === "calendar") {
    return (
      <View style={styles.calendarIcon}>
        <View style={styles.calendarHeader} />
        <View style={styles.calendarGrid}>
          <View style={styles.calendarDot} />
          <View style={styles.calendarDot} />
          <View style={styles.calendarDot} />
          <View style={styles.calendarDot} />
        </View>
      </View>
    );
  }
  if (name === "deadline") {
    return (
      <View style={styles.alarmIcon}>
        <View style={[styles.alarmBell, styles.alarmBellLeft]} />
        <View style={[styles.alarmBell, styles.alarmBellRight]} />
        <View style={styles.alarmFace}>
          <View style={styles.alarmHourHand} />
          <View style={styles.alarmMinuteHand} />
        </View>
      </View>
    );
  }
  if (name === "priority") {
    return (
      <View style={styles.priorityIcon}>
        <View style={styles.priorityPole} />
        <View style={styles.priorityFlag} />
      </View>
    );
  }
  if (name === "state") {
    return (
      <View style={styles.stateIcon}>
        <View style={styles.stateCheck} />
      </View>
    );
  }
  return (
    <View style={styles.addIcon}>
      <View style={styles.addVertical} />
      <View style={styles.addHorizontal} />
    </View>
  );
}

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

type DocumentEditTheme = {
  background: string;
  inputBackground: string;
  text: string;
  muted: string;
  border: string;
  placeholder: string;
  selection: string;
};

function documentEditTheme(dark: boolean): DocumentEditTheme {
  return dark
    ? {
        background: "#071008",
        inputBackground: "#0C150B",
        text: "#F2F5EC",
        muted: "#A7AEA0",
        border: "#303B2D",
        placeholder: "#6F7769",
        selection: "#7F9F52",
      }
    : {
        background: "#FAF9FD",
        inputBackground: "#FFFFFF",
        text: "#252832",
        muted: "#6B7280",
        border: "#DADAE4",
        placeholder: "#9CA3AF",
        selection: "#AFC0FF",
      };
}

export default function LibraryScreen() {
  const queryClient = useQueryClient();
  const bridgeConfig = useBridgeConfig();
  const params = useLocalSearchParams<{ path?: string | string[] }>();
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
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(null);
  const [selectedDocumentLine, setSelectedDocumentLine] = useState<number | null>(null);
  const [activeDocumentDialog, setActiveDocumentDialog] = useState<DocumentDialog>(null);
  const [clipboardBlock, setClipboardBlock] = useState("");
  const [isEditingDocument, setIsEditingDocument] = useState(false);
  const [documentDraftRaw, setDocumentDraftRaw] = useState("");
  const [newHeadingTitle, setNewHeadingTitle] = useState("New item");
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === "dark";
  const editTheme = documentEditTheme(isDarkMode);
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

  // Open requests arrive as a route param (e.g. from the roam screen). Apply
  // each request once and then clear the param: leaving it set would fight the
  // not-found cleanup effect below in an endless setState loop, and would
  // re-open the note every time the user navigates back to the grid.
  useEffect(() => {
    const pathParam = Array.isArray(params.path) ? params.path[0] : params.path;
    if (!pathParam || !documentsQuery.data) {
      return;
    }
    const resolved = resolveDocumentPath(
      pathParam,
      documentsQuery.data.map((doc) => doc.path),
    );
    if (resolved) {
      setSelectedPath(resolved);
      setSearchQuery("");
    } else {
      console.warn("Postep open request did not match any document", {
        path: pathParam,
      });
    }
    router.setParams({ path: "" });
  }, [params.path, documentsQuery.data]);

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

  useEffect(() => {
    setSelectedDocumentKey(null);
    setSelectedDocumentLine(null);
    setActiveDocumentDialog(null);
    setIsEditingDocument(false);
    setDocumentDraftRaw("");
  }, [selectedPath]);

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

  useEffect(() => {
    if (!isEditingDocument) {
      setDocumentDraftRaw(documentQuery.data?.raw ?? "");
    }
  }, [documentQuery.data?.raw, isEditingDocument]);

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
  const lexicalDocument = useMemo(
    () =>
      measureInteraction("lexicalProjection", () =>
        createOrgLexicalDocument(
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
      ? lexicalDocument.metric.elapsedMs
      : noteGrid.metric.elapsedMs;
    const label = selectedPath ? "Render model" : "Card grid";
    setInteractionStatus(`${label} ${metric.toFixed(2)}ms`);
  }, [lexicalDocument.metric.elapsedMs, noteGrid.metric.elapsedMs, selectedPath]);

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

  const rawDocument = documentQuery.data?.raw ?? "";
  const selectedActionLine = selectedDocumentLine ?? findHeadingRange(rawDocument, null)?.start ?? 0;

  const selectDocumentNode = (
    node: LexicalProjectionNode,
    _index: number,
    key: string,
  ) => {
    setSelectedDocumentKey(key);
    setSelectedDocumentLine(node.lineStart ?? null);
  };

  const persistDocumentAction = (nextRaw: string, label: string) => {
    if (nextRaw === rawDocument) {
      setInteractionStatus(`${label} no change`);
      return;
    }
    void persistRaw(nextRaw, label);
  };

  const openEditor = () => {
    setDocumentDraftRaw(rawDocument);
    setIsEditingDocument(true);
    setActiveDocumentDialog(null);
  };

  const saveDocumentEdit = () => {
    persistDocumentAction(documentDraftRaw, "documentEdit");
    setIsEditingDocument(false);
  };

  const cancelDocumentEdit = () => {
    setDocumentDraftRaw(rawDocument);
    setIsEditingDocument(false);
  };

  const cutSelectedItem = () => {
    const result = cutHeadingBlock(rawDocument, selectedActionLine);
    setClipboardBlock(result.block);
    persistDocumentAction(result.raw, "documentCut");
  };

  const copySelectedItem = () => {
    const block = copyHeadingBlock(rawDocument, selectedActionLine);
    setClipboardBlock(block);
    setInteractionStatus("documentCopy ready");
  };

  const pasteSelectedItem = (placement: HeadingPlacement) => {
    persistDocumentAction(
      pasteHeadingBlock(rawDocument, clipboardBlock, selectedActionLine, placement),
      `documentPaste:${placement}`,
    );
    setActiveDocumentDialog(null);
  };

  const moveSelectedItem = (move: MoveKind) => {
    persistDocumentAction(moveHeading(rawDocument, selectedActionLine, move), `documentMove:${move}`);
    setActiveDocumentDialog(null);
  };

  const setPlanningFromShortcut = (
    keyword: "SCHEDULED" | "DEADLINE",
    shortcut: "today" | "tomorrow" | "clear",
  ) => {
    const timestamp = shortcut === "clear" ? null : timestampShortcut(shortcut);
    persistDocumentAction(
      setPlanningTimestamp(rawDocument, selectedActionLine, keyword, timestamp),
      `document${keyword}`,
    );
    setActiveDocumentDialog(null);
  };

  const createHeading = (placement: HeadingPlacement) => {
    persistDocumentAction(
      insertHeading(rawDocument, newHeadingTitle, selectedActionLine, placement),
      `documentAdd:${placement}`,
    );
    setNewHeadingTitle("New item");
    setActiveDocumentDialog(null);
  };

  const refileTargets = headingChoices(rawDocument)
    .filter((heading) => heading.lineStart !== selectedActionLine)
    .slice(0, 8);

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

  const closeDocumentDialog = () => setActiveDocumentDialog(null);

  const applyHeadingState = (state: string | null) => {
    persistDocumentAction(
      setHeadingState(rawDocument, selectedActionLine, state),
      state ? `documentState:${state}` : "documentState:clear",
    );
    closeDocumentDialog();
  };

  const applyHeadingPriority = (priority: string | null) => {
    persistDocumentAction(
      setHeadingPriority(rawDocument, selectedActionLine, priority),
      priority ? `documentPriority:${priority}` : "documentPriority:clear",
    );
    closeDocumentDialog();
  };

  const archiveSelectedItem = () => {
    persistDocumentAction(
      archiveHeading(rawDocument, selectedActionLine),
      "documentArchive",
    );
    closeDocumentDialog();
  };

  const toggleSelectedState = () => {
    persistDocumentAction(
      toggleHeadingState(rawDocument, selectedActionLine),
      "documentState:toggle",
    );
    closeDocumentDialog();
  };

  const refileSelectedItem = (targetLineStart: number) => {
    persistDocumentAction(
      refileHeadingUnder(rawDocument, selectedActionLine, targetLineStart),
      "documentRefile",
    );
    closeDocumentDialog();
  };

  const renderDialogButton = (
    label: string,
    onPress: () => void,
    testID: string,
    secondary = false,
  ) => (
    <TouchableOpacity
      key={testID}
      style={[
        secondary ? styles.documentDialogButtonSecondary : styles.documentDialogButton,
        secondary ? { backgroundColor: editTheme.inputBackground, borderColor: editTheme.border } : null,
      ]}
      onPress={onPress}
      testID={testID}
    >
      <Text
        style={[
          secondary
            ? styles.documentDialogButtonSecondaryText
            : styles.documentDialogButtonText,
          secondary ? { color: editTheme.text } : null,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderPlacementButtons = (
    prefix: string,
    action: (placement: HeadingPlacement) => void,
  ) => (
    <View style={styles.documentDialogActionGrid}>
      {renderDialogButton("Above", () => action("above"), `${prefix}-above`)}
      {renderDialogButton("Under", () => action("under"), `${prefix}-under`)}
      {renderDialogButton("Below", () => action("below"), `${prefix}-below`)}
    </View>
  );

  const documentDialogTitle =
    activeDocumentDialog === "overflow"
      ? "Document actions"
      : activeDocumentDialog === "paste"
        ? "Paste item"
        : activeDocumentDialog === "move"
          ? "Move item"
          : activeDocumentDialog === "refile"
            ? "Archive or refile"
            : activeDocumentDialog === "schedule"
              ? "Schedule"
              : activeDocumentDialog === "deadline"
                ? "Deadline"
                : activeDocumentDialog === "priority"
                  ? "Priority"
                  : activeDocumentDialog === "state"
                    ? "State"
                    : activeDocumentDialog === "add"
                      ? "Add item"
                      : "";

  const documentDialogTestID = activeDocumentDialog
    ? `document-${activeDocumentDialog === "overflow" ? "action" : activeDocumentDialog}-menu`
    : undefined;

  const renderDocumentDialogContent = () => {
    if (activeDocumentDialog === "overflow") {
      return (
        <View style={styles.documentDialogSection}>
          {renderDialogButton("Edit source", openEditor, "document-action-edit-source")}
          {renderDialogButton(
            readerMode ? "Reader off" : "Reader on",
            () => {
              setReaderMode((value) => !value);
              closeDocumentDialog();
            },
            "document-action-toggle-reader",
          )}
          {renderDialogButton(
            outlineOnly ? "Outline off" : "Outline on",
            () => {
              setOutlineOnly((value) => !value);
              closeDocumentDialog();
            },
            "document-action-toggle-outline",
          )}
          {renderDialogButton("Toggle done", toggleSelectedState, "document-action-toggle-state")}
        </View>
      );
    }
    if (activeDocumentDialog === "paste") {
      return clipboardBlock.trim() ? (
        renderPlacementButtons("document-paste", pasteSelectedItem)
      ) : (
        <Text style={[styles.documentDialogHint, { color: editTheme.muted }]}>Copy or cut an item first.</Text>
      );
    }
    if (activeDocumentDialog === "move") {
      return (
        <View style={styles.documentDialogActionGrid}>
          {renderDialogButton("Up", () => moveSelectedItem("up"), "document-move-up")}
          {renderDialogButton("Down", () => moveSelectedItem("down"), "document-move-down")}
          {renderDialogButton("Promote", () => moveSelectedItem("promote"), "document-move-promote")}
          {renderDialogButton("Demote", () => moveSelectedItem("demote"), "document-move-demote")}
        </View>
      );
    }
    if (activeDocumentDialog === "refile") {
      return (
        <View style={styles.documentDialogSection}>
          {renderDialogButton("Archive here", archiveSelectedItem, "document-refile-archive")}
          {refileTargets.length > 0 ? (
            refileTargets.map((target) =>
              renderDialogButton(
                `${"  ".repeat(Math.max(target.depth - 1, 0))}${target.title}`,
                () => refileSelectedItem(target.lineStart),
                `document-refile-target-${target.lineStart}`,
                true,
              ),
            )
          ) : (
            <Text style={[styles.documentDialogHint, { color: editTheme.muted }]}>No other headings available.</Text>
          )}
        </View>
      );
    }
    if (activeDocumentDialog === "schedule" || activeDocumentDialog === "deadline") {
      const keyword = activeDocumentDialog === "schedule" ? "SCHEDULED" : "DEADLINE";
      const prefix = activeDocumentDialog === "schedule" ? "document-schedule" : "document-deadline";
      return (
        <View style={styles.documentDialogActionGrid}>
          {renderDialogButton("Today", () => setPlanningFromShortcut(keyword, "today"), `${prefix}-today`)}
          {renderDialogButton("Tomorrow", () => setPlanningFromShortcut(keyword, "tomorrow"), `${prefix}-tomorrow`)}
          {renderDialogButton("Clear", () => setPlanningFromShortcut(keyword, "clear"), `${prefix}-clear`, true)}
        </View>
      );
    }
    if (activeDocumentDialog === "priority") {
      return (
        <View style={styles.documentDialogActionGrid}>
          {renderDialogButton("A", () => applyHeadingPriority("A"), "document-priority-a")}
          {renderDialogButton("B", () => applyHeadingPriority("B"), "document-priority-b")}
          {renderDialogButton("C", () => applyHeadingPriority("C"), "document-priority-c")}
          {renderDialogButton("Clear", () => applyHeadingPriority(null), "document-priority-clear", true)}
        </View>
      );
    }
    if (activeDocumentDialog === "state") {
      return (
        <View style={styles.documentDialogActionGrid}>
          {["TODO", "NEXT", "DONE", "WAITING", "CANCELLED"].map((state) =>
            renderDialogButton(state, () => applyHeadingState(state), `document-state-${state.toLowerCase()}`),
          )}
          {renderDialogButton("Clear", () => applyHeadingState(null), "document-state-clear", true)}
        </View>
      );
    }
    if (activeDocumentDialog === "add") {
      return (
        <View style={styles.documentDialogSection}>
          <TextInput
            testID="document-add-title"
            style={[
              styles.documentDialogInput,
              {
                backgroundColor: editTheme.inputBackground,
                borderColor: editTheme.border,
                color: editTheme.text,
              },
            ]}
            value={newHeadingTitle}
            onChangeText={setNewHeadingTitle}
            placeholder="Heading title"
            placeholderTextColor={editTheme.placeholder}
            autoCapitalize="sentences"
          />
          {renderPlacementButtons("document-add", createHeading)}
        </View>
      );
    }
    return null;
  };

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
      <Modal
        visible={activeDocumentDialog !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDocumentDialog}
        testID={documentDialogTestID ? `${documentDialogTestID}-modal` : undefined}
      >
        <View style={styles.documentDialogLayer}>
          <Pressable
            style={styles.documentDialogScrim}
            onPress={closeDocumentDialog}
            testID="document-dialog-scrim"
          />
          <View
            style={[styles.documentDialogCard, { backgroundColor: editTheme.background }]}
            testID={documentDialogTestID}
          >
            <View style={styles.documentDialogHeader}>
              <Text style={[styles.documentDialogTitle, { color: editTheme.text }]}>{documentDialogTitle}</Text>
              <TouchableOpacity
                style={styles.documentDialogClose}
                onPress={closeDocumentDialog}
                testID="document-dialog-close"
                accessibilityLabel="Close document dialog"
              >
                <Text style={[styles.documentDialogCloseText, { color: editTheme.muted }]}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.documentDialogSubtitle, { color: editTheme.muted }]}>
              Selected line {selectedActionLine + 1}
            </Text>
            {renderDocumentDialogContent()}
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
      ) : (
        <View style={styles.editorScreen}>
          <View style={styles.documentTopBar}>
            <TouchableOpacity
              onPress={() => setSelectedPath(null)}
              style={styles.iconButton}
              testID="back-to-notes"
            >
              <Text style={styles.documentBackIcon}>‹</Text>
            </TouchableOpacity>
            <View style={styles.editorTitleBlock}>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {selectedName.replace(/\.org$/i, "")}
              </Text>
              {interactionStatus && (
                <Text style={styles.editorSubtitle}>{interactionStatus}</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.documentIconButton}
              accessibilityLabel="Cut selected item"
              testID="document-action-cut"
              onPress={cutSelectedItem}
            >
              <GraphicalActionIcon name="cut" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.documentIconButton}
              accessibilityLabel="Copy selected item"
              testID="document-action-copy"
              onPress={copySelectedItem}
            >
              <GraphicalActionIcon name="copy" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.documentIconButton}
              accessibilityLabel="Paste item"
              testID="document-action-paste"
              onPress={() => setActiveDocumentDialog("paste")}
            >
              <GraphicalActionIcon name="paste" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.documentIconButton}
              accessibilityLabel="Move selected item"
              testID="document-action-move"
              onPress={() => setActiveDocumentDialog("move")}
            >
              <GraphicalActionIcon name="move" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.documentIconButton}
              accessibilityLabel="More document actions"
              testID="document-action-overflow"
              onPress={() => setActiveDocumentDialog("overflow")}
            >
              <GraphicalActionIcon name="overflow" />
            </TouchableOpacity>
          </View>

          <View style={styles.documentModeBar}>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Reader</Text>
              <Switch value={readerMode} onValueChange={setReaderMode} />
            </View>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Outline</Text>
              <Switch value={outlineOnly} onValueChange={setOutlineOnly} />
            </View>
          </View>

          <ScrollView
            testID="document-scroll"
            style={styles.documentScroll}
            contentContainerStyle={styles.orgDocumentContent}
          >
            {documentQuery.isFetching ? (
              <ActivityIndicator
                style={{ marginVertical: 24 }}
                color="#5F6F85"
              />
            ) : documentQuery.data ? (
              isEditingDocument ? (
                <View style={[styles.documentEditLane, { backgroundColor: editTheme.background, borderColor: editTheme.border }]} testID="document-edit-lane">
                  <Text style={[styles.documentEditTitle, { color: editTheme.text }]}>Edit source</Text>
                  <TextInput
                    testID="document-edit-source"
                    accessibilityLabel="Edit document source"
                    style={[styles.documentSourceInput, { backgroundColor: editTheme.inputBackground, color: editTheme.text, borderColor: editTheme.border }]}
                    value={documentDraftRaw}
                    onChangeText={setDocumentDraftRaw}
                    multiline
                    textAlignVertical="top"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Org source"
                    placeholderTextColor={editTheme.placeholder}
                    selectionColor={editTheme.selection}
                    showSoftInputOnFocus={process.env.EXPO_PUBLIC_POSTEP_E2E === "1" ? false : undefined}
                  />
                  <View style={styles.documentEditActions}>
                    <TouchableOpacity style={styles.documentDialogButton} testID="document-edit-save" accessibilityLabel="Save" onPress={saveDocumentEdit}>
                      <Text style={styles.documentDialogButtonText}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.documentDialogButtonSecondary} testID="document-edit-cancel" accessibilityLabel="Cancel" onPress={cancelDocumentEdit}>
                      <Text style={styles.documentDialogButtonSecondaryText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <LexicalDocument
                  value={lexicalDocument.value.projection}
                  selectedKey={selectedDocumentKey}
                  onSelectNode={selectDocumentNode}
                />
              )
            ) : (
              <Text style={styles.emptyDocument}>
                Select an Org file to view its contents.
              </Text>
            )}
          </ScrollView>

          <View style={styles.orgBottomToolbar}>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Archive or refile item"
              testID="document-bottom-archive"
              onPress={() => setActiveDocumentDialog("refile")}
            >
              <GraphicalActionIcon name="archive" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Schedule item"
              testID="document-bottom-schedule"
              onPress={() => setActiveDocumentDialog("schedule")}
            >
              <GraphicalActionIcon name="calendar" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Set item deadline"
              testID="document-bottom-deadline"
              onPress={() => setActiveDocumentDialog("deadline")}
            >
              <GraphicalActionIcon name="deadline" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Set item priority"
              testID="document-bottom-priority"
              onPress={() => setActiveDocumentDialog("priority")}
            >
              <GraphicalActionIcon name="priority" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Change item state"
              testID="document-bottom-state"
              onPress={() => setActiveDocumentDialog("state")}
            >
              <GraphicalActionIcon name="state" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.orgBottomTool}
              accessibilityLabel="Create new item"
              testID="document-bottom-add"
              onPress={() => setActiveDocumentDialog("add")}
            >
              <GraphicalActionIcon name="add" />
            </TouchableOpacity>
          </View>
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
  documentDialogLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  documentDialogScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.34)",
  },
  documentDialogCard: {
    marginHorizontal: 12,
    marginBottom: 18,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#FAF9FD",
    borderWidth: 1,
    borderColor: "#DADAE4",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  documentDialogHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 2,
  },
  documentDialogTitle: {
    flex: 1,
    color: "#252832",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  documentDialogSubtitle: {
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 14,
  },
  documentDialogClose: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECECF6",
  },
  documentDialogCloseText: {
    color: "#30343F",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  documentDialogSection: { gap: 10 },
  documentDialogActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  documentDialogButton: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4D5F31",
    borderWidth: 1,
    borderColor: "#6E814E",
  },
  documentDialogButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  documentDialogButtonSecondary: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ECECF6",
    borderWidth: 1,
    borderColor: "#DADAE4",
  },
  documentDialogButtonSecondaryText: {
    color: "#30343F",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  documentDialogHint: {
    color: "#6B7280",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  documentDialogInput: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DADAE4",
    backgroundColor: "#FFFFFF",
    color: "#252832",
    paddingHorizontal: 14,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
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
  editorScreen: { flex: 1, backgroundColor: "#FAF9FD" },
  documentTopBar: {
    minHeight: 68,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DADAE4",
    backgroundColor: "#ECECF6",
    gap: 8,
  },
  documentBackIcon: {
    color: "#22252F",
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "300",
  },
  documentIconButton: {
    width: 34,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  documentIconText: {
    color: "#343843",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "700",
  },
  cutIcon: {
    width: 26,
    height: 26,
    position: "relative",
  },
  cutBlade: {
    position: "absolute",
    left: 11,
    top: 2,
    width: 3,
    height: 17,
    borderRadius: 2,
    backgroundColor: "#343843",
  },
  cutBladeLeft: { transform: [{ rotate: "45deg" }] },
  cutBladeRight: { transform: [{ rotate: "-45deg" }] },
  cutHandle: {
    position: "absolute",
    bottom: 1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#343843",
  },
  cutHandleLeft: { left: 3 },
  cutHandleRight: { right: 3 },
  copyIcon: {
    width: 27,
    height: 27,
    position: "relative",
  },
  copyIconSquare: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "#343843",
    backgroundColor: "#ECECF6",
  },
  copyIconBack: { left: 4, top: 4, opacity: 0.72 },
  copyIconFront: { left: 9, top: 9 },
  clipboardIcon: {
    width: 23,
    height: 27,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#343843",
    alignItems: "center",
    paddingTop: 8,
    gap: 4,
  },
  clipboardClip: {
    position: "absolute",
    top: -4,
    width: 12,
    height: 7,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "#343843",
    backgroundColor: "#ECECF6",
  },
  clipboardLine: {
    width: 13,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#343843",
  },
  clipboardLineShort: { width: 9 },
  moveIcon: {
    width: 26,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  moveArrowHead: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  moveArrowUp: {
    top: 1,
    borderBottomWidth: 7,
    borderBottomColor: "#343843",
  },
  moveArrowDown: {
    bottom: 1,
    borderTopWidth: 7,
    borderTopColor: "#343843",
  },
  moveStem: {
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: "#343843",
  },
  overflowIcon: {
    width: 24,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  overflowDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#343843",
  },
  archiveIcon: {
    width: 27,
    height: 24,
    borderRadius: 3,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: "#30343F",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  archiveLid: {
    position: "absolute",
    top: -5,
    width: 29,
    height: 7,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: "#30343F",
    backgroundColor: "#ECECF6",
  },
  archiveArrowStem: {
    width: 3,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#30343F",
    marginTop: 1,
  },
  archiveArrowHead: {
    width: 9,
    height: 9,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: "#30343F",
    transform: [{ rotate: "45deg" }],
    marginTop: -7,
  },
  calendarIcon: {
    width: 27,
    height: 27,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#30343F",
    overflow: "hidden",
  },
  calendarHeader: {
    height: 7,
    backgroundColor: "#30343F",
  },
  calendarGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    gap: 4,
    padding: 4,
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#30343F",
  },
  alarmIcon: {
    width: 29,
    height: 29,
    alignItems: "center",
    justifyContent: "flex-end",
    position: "relative",
  },
  alarmBell: {
    position: "absolute",
    top: 1,
    width: 9,
    height: 6,
    borderRadius: 4,
    backgroundColor: "#30343F",
  },
  alarmBellLeft: { left: 3, transform: [{ rotate: "-25deg" }] },
  alarmBellRight: { right: 3, transform: [{ rotate: "25deg" }] },
  alarmFace: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#30343F",
    alignItems: "center",
    justifyContent: "center",
  },
  alarmHourHand: {
    position: "absolute",
    width: 2,
    height: 7,
    borderRadius: 1,
    backgroundColor: "#30343F",
    top: 5,
  },
  alarmMinuteHand: {
    position: "absolute",
    width: 7,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#30343F",
    left: 10,
    top: 11,
  },
  priorityIcon: {
    width: 25,
    height: 27,
    position: "relative",
  },
  priorityPole: {
    position: "absolute",
    left: 5,
    top: 2,
    width: 3,
    height: 23,
    borderRadius: 2,
    backgroundColor: "#30343F",
  },
  priorityFlag: {
    position: "absolute",
    left: 8,
    top: 3,
    width: 14,
    height: 11,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: "#30343F",
  },
  stateIcon: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#30343F",
    alignItems: "center",
    justifyContent: "center",
  },
  stateCheck: {
    width: 13,
    height: 7,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderColor: "#30343F",
    transform: [{ rotate: "-45deg" }],
    marginTop: -2,
  },
  addIcon: {
    width: 27,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  addVertical: {
    position: "absolute",
    width: 3,
    height: 21,
    borderRadius: 2,
    backgroundColor: "#30343F",
  },
  addHorizontal: {
    position: "absolute",
    width: 21,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#30343F",
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
  editorTitleBlock: { flex: 1, minWidth: 0 },
  editorTitle: { color: "#252832", fontSize: 20, fontWeight: "800" },
  editorSubtitle: { color: "#6B7280", fontSize: 11, marginTop: 2 },
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
  switchLabel: { color: "#4B5563", fontSize: 16, fontWeight: "700" },
  documentModeBar: {
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DADAE4",
    backgroundColor: "#FAF9FD",
  },
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
  documentScroll: { flex: 1, backgroundColor: "#FAF9FD" },
  orgDocumentContent: {
    flexGrow: 1,
    paddingBottom: 110,
    backgroundColor: "#FAF9FD",
  },
  documentEditLane: {
    margin: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  documentEditTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    marginBottom: 10,
  },
  documentSourceInput: {
    minHeight: 420,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  documentEditActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },
  orgBottomToolbar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 78,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ECECF6",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DADAE4",
  },
  orgBottomTool: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  orgBottomToolText: {
    color: "#30343F",
    fontSize: 25,
    lineHeight: 29,
    fontWeight: "800",
  },
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
