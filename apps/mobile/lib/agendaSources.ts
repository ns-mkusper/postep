import {
  loadAgendaSnapshotAsync,
  type AgendaItem,
  type AgendaSnapshot,
  type Habit,
  type LexicalNode,
  type OrgBridgeConfig,
} from "@postep/bridge";

import {
  isSafUri,
  listDocumentsForConfig,
  loadDocumentForConfig,
} from "./documentSources";

const AGENDA_LOAD_LIMIT = 300;
const AGENDA_LOAD_CONCURRENCY = 12;
const AGENDA_DOC_LOAD_TIMEOUT_MS = 5000;
const TODO_KEYWORDS = new Set([
  "TODO",
  "WAITING",
  "INPROG-TODO",
  "HW",
  "STUDY",
  "SOMEDAY",
  "READ",
  "PROJ",
  "CONTACT",
]);
type RepeaterUnit = NonNullable<AgendaItem["repeater"]>["unit"];

export async function loadAgendaSnapshotForConfig(
  config: OrgBridgeConfig,
): Promise<AgendaSnapshot> {
  if (config.roots.length === 0 && (config.roamRoots?.length ?? 0) === 0) {
    return { items: [], habits: [] };
  }

  if (!hasSafRoots(config)) {
    return loadAgendaSnapshotAsync(config);
  }

  const startedAt = Date.now();
  const documents = (await listDocumentsForConfig(config)).slice(
    0,
    AGENDA_LOAD_LIMIT,
  );
  const snapshots = await mapConcurrent(
    documents,
    AGENDA_LOAD_CONCURRENCY,
    async (doc) => {
      try {
        const payload = await withTimeout(
          loadDocumentForConfig(config, doc.path),
          AGENDA_DOC_LOAD_TIMEOUT_MS,
          `Timed out reading ${doc.name}`,
        );
        return buildAgendaFromDocument(payload.path, payload.raw, payload.lexical);
      } catch (error) {
        console.warn("Postep agenda document skipped", {
          name: doc.name,
          path: doc.path,
          message: error instanceof Error ? error.message : String(error),
        });
        return { items: [], habits: [] };
      }
    },
  );
  const snapshot = snapshots.reduce<AgendaSnapshot>(
    (merged, next) => ({
      items: [...merged.items, ...next.items],
      habits: [...merged.habits, ...next.habits],
    }),
    { items: [], habits: [] },
  );

  console.log("Postep agenda listing", {
    documents: documents.length,
    items: snapshot.items.length,
    habits: snapshot.habits.length,
    elapsedMs: Date.now() - startedAt,
  });

  return snapshot;
}

export async function setAgendaStatusForConfig(
  config: OrgBridgeConfig,
  item: AgendaItem,
  status: string,
): Promise<AgendaSnapshot> {
  if (!isSafUri(item.path)) {
    const { setAgendaStatusAsync } = await import("@postep/bridge");
    return setAgendaStatusAsync({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: item.path,
      headlineLine: item.headline_line,
      status,
    });
  }

  const { updateDocumentForConfig } = await import("./documentSources");
  const payload = await loadDocumentForConfig(config, item.path);
  const lines = payload.raw.split("\n");
  const current = lines[item.headline_line];
  if (current) {
    lines[item.headline_line] = replaceHeadingStatus(current, status);
    await updateDocumentForConfig({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: item.path,
      raw: lines.join("\n"),
    });
  }
  return loadAgendaSnapshotForConfig(config);
}

function hasSafRoots(config: OrgBridgeConfig): boolean {
  return (
    config.roots.some(isSafUri) ||
    (config.roamRoots?.some(isSafUri) ?? false)
  );
}

function buildAgendaFromDocument(
  path: string,
  raw: string,
  nodes: LexicalNode[],
): AgendaSnapshot {
  const items: AgendaItem[] = [];
  const habits: Habit[] = [];
  const headings = nodes.filter(
    (node): node is Extract<LexicalNode, { type: "heading" }> =>
      node.type === "heading",
  );

  for (const heading of headings) {
    const nextHeading = headings.find(
      (node) => node.line_start > heading.line_start,
    );
    const bodyNodes = nodes.filter(
      (node) =>
        node.line_start > heading.line_start &&
        (!nextHeading || node.line_start < nextHeading.line_start),
    );
    const scheduled = bodyNodes.find(
      (node): node is Extract<LexicalNode, { type: "planning" }> =>
        node.type === "planning" && node.keyword === "SCHEDULED",
    );
    const deadline = bodyNodes.find(
      (node): node is Extract<LexicalNode, { type: "planning" }> =>
        node.type === "planning" && node.keyword === "DEADLINE",
    );
    const propertyDrawer = bodyNodes.find(
      (node): node is Extract<LexicalNode, { type: "property_drawer" }> =>
        node.type === "property_drawer",
    );
    const planning = scheduled ?? deadline;
    const hasTodo = Boolean(
      heading.todo_keyword && TODO_KEYWORDS.has(heading.todo_keyword),
    );
    const styleHabit =
      propertyDrawer?.properties.STYLE?.toLowerCase() === "habit" ||
      heading.tags.includes("habit");

    if (!planning && !hasTodo && !styleHabit) {
      continue;
    }

    items.push({
      title: heading.text,
      date: timestampDate(planning?.text) ?? null,
      time: planning?.text?.match(/\b\d{2}:\d{2}\b/)?.[0] ?? null,
      context: contextFromNodes(bodyNodes),
      path,
      headline_line: heading.line_start,
      todo_keyword: heading.todo_keyword,
      kind: scheduled ? "Scheduled" : deadline ? "Deadline" : "Floating",
      timestamp_raw: planning?.text ?? null,
      repeater: repeaterFromTimestamp(planning?.text),
    });

    if (styleHabit) {
      habits.push({
        title: `${heading.todo_keyword ? `${heading.todo_keyword} ` : ""}${heading.text}`,
        scheduled: timestampDate(scheduled?.text) ?? null,
        description: bodyNodes
          .filter((node) => node.type === "list_item")
          .map((node) => `- ${node.text}`)
          .join("\n"),
        repeater: scheduled?.text
          ? { raw: scheduled.text, frequency: null }
          : null,
        log_entries: [],
        last_repeat:
          propertyDrawer?.properties.LAST_REPEAT?.match(
            /\[(\d{4}-\d{2}-\d{2})/,
          )?.[1] ?? null,
      });
    }
  }

  return { items, habits };
}

function contextFromNodes(nodes: LexicalNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type === "paragraph" || node.type === "list_item") {
        return [node.text];
      }
      if (node.type === "table") {
        return [node.rows.map((row) => row.join(" · ")).join("\n")];
      }
      return [];
    })
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
}

function timestampDate(text?: string | null): string | null {
  if (!text) {
    return null;
  }
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function repeaterFromTimestamp(
  text?: string | null,
): AgendaItem["repeater"] {
  const match = text?.match(/(?:\+\+|\.?\+)(\d+)([dwmy])/i);
  if (!match) {
    return null;
  }
  const units: Record<string, RepeaterUnit> = {
    d: "Day",
    w: "Week",
    m: "Month",
    y: "Year",
  };
  return {
    amount: Number.parseInt(match[1], 10),
    unit: units[match[2].toLowerCase()],
  };
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function replaceHeadingStatus(line: string, status: string): string {
  return line.replace(
    /^(\*+\s+)(?:[A-Z][A-Z_-]*\s+)?(.*)$/,
    (_match, prefix: string, body: string) => `${prefix}${status} ${body}`,
  );
}
