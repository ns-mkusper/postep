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
  updateDocumentForConfig,
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
        return buildAgendaFromDocument(
          payload.path,
          payload.raw,
          payload.lexical,
        );
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
  previousSnapshot?: AgendaSnapshot,
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

  const payload = await loadDocumentForConfig(config, item.path);
  const lines = payload.raw.split("\n");
  const current = lines[item.headline_line];
  if (current) {
    lines[item.headline_line] = replaceHeadingStatus(current, status);
    const updated = await updateDocumentForConfig({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: item.path,
      raw: lines.join("\n"),
    });
    const changedSnapshot = buildAgendaFromDocument(
      updated.path,
      updated.raw,
      updated.lexical,
    );
    if (previousSnapshot) {
      return mergeChangedDocumentSnapshot(
        previousSnapshot,
        item.path,
        changedSnapshot,
      );
    }
  }
  return loadAgendaSnapshotForConfig(config);
}

export async function completeHabitForConfig(
  config: OrgBridgeConfig,
  item: AgendaItem,
  previousSnapshot?: AgendaSnapshot,
): Promise<AgendaSnapshot> {
  if (!isSafUri(item.path)) {
    return setAgendaStatusForConfig(config, item, "DONE", previousSnapshot);
  }

  const payload = await loadDocumentForConfig(config, item.path);
  const lines = payload.raw.split("\n");
  const nextRaw = completeHabitRaw(lines, item);
  const updated = await updateDocumentForConfig({
    roots: config.roots,
    roamRoots: config.roamRoots,
    path: item.path,
    raw: nextRaw,
  });
  const changedSnapshot = buildAgendaFromDocument(
    updated.path,
    updated.raw,
    updated.lexical,
  );
  if (previousSnapshot) {
    return mergeChangedDocumentSnapshot(
      previousSnapshot,
      item.path,
      changedSnapshot,
    );
  }
  return loadAgendaSnapshotForConfig(config);
}

export async function deleteHabitForConfig(
  config: OrgBridgeConfig,
  habit: Habit,
  previousSnapshot?: AgendaSnapshot,
): Promise<AgendaSnapshot> {
  const path = habit.path;
  const headlineLine = habit.headline_line;
  if (!path || headlineLine === undefined) {
    const { deleteHabitAsync } = await import("@postep/bridge");
    return deleteHabitAsync({
      roots: config.roots,
      roamRoots: config.roamRoots,
      path: config.roots[0] ?? "",
      title: habit.title.replace(/^[A-Z][A-Z_-]*\s+/, ""),
    });
  }

  const payload = await loadDocumentForConfig(config, path);
  const lines = payload.raw.split("\n");
  const end = findHeadingEnd(lines, headlineLine);
  lines.splice(headlineLine, end - headlineLine);
  const updated = await updateDocumentForConfig({
    roots: config.roots,
    roamRoots: config.roamRoots,
    path,
    raw: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
  });
  const changedSnapshot = buildAgendaFromDocument(
    updated.path,
    updated.raw,
    updated.lexical,
  );
  if (previousSnapshot) {
    return mergeChangedDocumentSnapshot(
      previousSnapshot,
      path,
      changedSnapshot,
    );
  }
  return loadAgendaSnapshotForConfig(config);
}

function hasSafRoots(config: OrgBridgeConfig): boolean {
  return (
    config.roots.some(isSafUri) || (config.roamRoots?.some(isSafUri) ?? false)
  );
}

function buildAgendaFromDocument(
  path: string,
  raw: string,
  nodes: LexicalNode[],
): AgendaSnapshot {
  void raw;
  const items: AgendaItem[] = [];
  const habits: Habit[] = [];
  const headings = nodes.filter(
    (node): node is Extract<LexicalNode, { type: "heading" }> =>
      node.type === "heading",
  );
  const headingRanges = headings.map((heading, index) => ({
    heading,
    end: headings[index + 1]?.line_start ?? Number.POSITIVE_INFINITY,
    bodyNodes: [] as LexicalNode[],
  }));

  let rangeIndex = 0;
  for (const node of nodes) {
    while (
      rangeIndex < headingRanges.length &&
      node.line_start >= headingRanges[rangeIndex].end
    ) {
      rangeIndex += 1;
    }
    const range = headingRanges[rangeIndex];
    if (!range || node.line_start <= range.heading.line_start) {
      continue;
    }
    range.bodyNodes.push(node);
  }

  for (const { heading, bodyNodes } of headingRanges) {
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
        log_entries: logEntriesFromNodes(bodyNodes),
        last_repeat:
          propertyDrawer?.properties.LAST_REPEAT?.match(
            /\[(\d{4}-\d{2}-\d{2})/,
          )?.[1] ?? null,
        path,
        headline_line: heading.line_start,
        todo_keyword: heading.todo_keyword,
        timestamp_raw: scheduled?.text ?? null,
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
    .slice(0, 2)
    .join("\n");
}

function timestampDate(text?: string | null): string | null {
  if (!text) {
    return null;
  }
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function repeaterFromTimestamp(text?: string | null): AgendaItem["repeater"] {
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

function logEntriesFromNodes(nodes: LexicalNode[]): Habit["log_entries"] {
  return nodes
    .flatMap((node) => {
      if (node.type !== "drawer" || node.name.toUpperCase() !== "LOGBOOK") {
        return [];
      }
      return [
        ...node.text.matchAll(
          /State "([^"]+)" from "[^"]*" \[(\d{4}-\d{2}-\d{2})/g,
        ),
      ].map((match) => ({ state: match[1], date: match[2] }));
    })
    .filter((entry) => entry.state && entry.date);
}

function mergeChangedDocumentSnapshot(
  previous: AgendaSnapshot,
  path: string,
  changed: AgendaSnapshot,
): AgendaSnapshot {
  return {
    items: mergeDocumentEntries(previous.items, path, changed.items),
    habits: mergeDocumentEntries(previous.habits, path, changed.habits),
  };
}

function mergeDocumentEntries<T extends { path?: string }>(
  previous: T[],
  path: string,
  changed: T[],
): T[] {
  const merged: T[] = [];
  let inserted = false;
  for (const entry of previous) {
    if (entry.path !== path) {
      merged.push(entry);
      continue;
    }
    if (!inserted) {
      merged.push(...changed);
      inserted = true;
    }
  }
  if (!inserted) {
    merged.push(...changed);
  }
  return merged;
}

function completeHabitRaw(lines: string[], item: AgendaItem): string {
  const today = localDateString();
  const heading = lines[item.headline_line];
  if (!heading) {
    return lines.join("\n");
  }

  if (!item.repeater || !item.date) {
    lines[item.headline_line] = replaceHeadingStatus(heading, "DONE");
    return lines.join("\n");
  }

  const rangeEnd = findHeadingEnd(lines, item.headline_line);
  const planningLine = findPlanningLine(
    lines,
    item.headline_line + 1,
    rangeEnd,
  );
  if (planningLine >= 0) {
    lines[planningLine] = replaceFirstDate(
      lines[planningLine],
      nextRepeaterDate(item.date, item.repeater),
    );
  }
  upsertLastRepeat(lines, item.headline_line, rangeEnd, today);
  appendLogbookEntry(
    lines,
    item.headline_line,
    findHeadingEnd(lines, item.headline_line),
    today,
  );
  lines[item.headline_line] = replaceHeadingStatus(heading, "TODO");
  return lines.join("\n");
}

function findHeadingEnd(lines: string[], headlineLine: number): number {
  const marker = lines[headlineLine]?.match(/^(\*+)\s/)?.[1] ?? "*";
  for (let index = headlineLine + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\*+)\s/);
    if (match && match[1].length <= marker.length) {
      return index;
    }
  }
  return lines.length;
}

function findPlanningLine(lines: string[], start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (/^\s*SCHEDULED:/i.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function replaceFirstDate(line: string, date: string): string {
  return line.replace(/\d{4}-\d{2}-\d{2}/, date);
}

function nextRepeaterDate(
  date: string,
  repeater: NonNullable<AgendaItem["repeater"]>,
): string {
  const next = new Date(`${date}T12:00:00`);
  if (repeater.unit === "Day") {
    next.setDate(next.getDate() + repeater.amount);
  } else if (repeater.unit === "Week") {
    next.setDate(next.getDate() + repeater.amount * 7);
  } else if (repeater.unit === "Month") {
    next.setMonth(next.getMonth() + repeater.amount);
  } else {
    next.setFullYear(next.getFullYear() + repeater.amount);
  }
  return localDateString(next);
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayName(date = new Date()): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
}

function upsertLastRepeat(
  lines: string[],
  headlineLine: number,
  rangeEnd: number,
  date: string,
): void {
  const stamp = `[${date} ${weekdayName(new Date(`${date}T12:00:00`))}]`;
  for (let index = headlineLine + 1; index < rangeEnd; index += 1) {
    if (/^\s*:LAST_REPEAT:/i.test(lines[index])) {
      lines[index] = `:LAST_REPEAT: ${stamp}`;
      return;
    }
  }

  const propertyStart = lines.findIndex(
    (line, index) =>
      index > headlineLine &&
      index < rangeEnd &&
      /^\s*:PROPERTIES:\s*$/i.test(line),
  );
  if (propertyStart >= 0) {
    const propertyEnd = lines.findIndex(
      (line, index) =>
        index > propertyStart &&
        index < rangeEnd &&
        /^\s*:END:\s*$/i.test(line),
    );
    lines.splice(
      propertyEnd >= 0 ? propertyEnd : propertyStart + 1,
      0,
      `:LAST_REPEAT: ${stamp}`,
    );
    return;
  }

  lines.splice(
    headlineLine + 1,
    0,
    ":PROPERTIES:",
    `:LAST_REPEAT: ${stamp}`,
    ":END:",
  );
}

function appendLogbookEntry(
  lines: string[],
  headlineLine: number,
  rangeEnd: number,
  date: string,
): void {
  const stamp = `[${date} ${weekdayName(new Date(`${date}T12:00:00`))}]`;
  const entry = `- State "DONE" from "${lines[headlineLine].includes("DONE") ? "DONE" : "TODO"}" ${stamp}`;
  const logbookStart = lines.findIndex(
    (line, index) =>
      index > headlineLine &&
      index < rangeEnd &&
      /^\s*:LOGBOOK:\s*$/i.test(line),
  );
  if (logbookStart >= 0) {
    lines.splice(logbookStart + 1, 0, entry);
    return;
  }
  lines.splice(rangeEnd, 0, ":LOGBOOK:", entry, ":END:");
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
