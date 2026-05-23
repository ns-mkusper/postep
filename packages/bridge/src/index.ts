export interface OrgBridgeConfig {
  roots: string[];
  roamRoots?: string[];
}

export interface AgendaItem {
  title: string;
  date?: string | null;
  time?: string | null;
  context: string;
  path: string;
  headline_line: number;
  todo_keyword?: string | null;
  kind: 'Scheduled' | 'Deadline' | 'Floating';
  timestamp_raw?: string | null;
  repeater?: {
    amount: number;
    unit: 'Day' | 'Week' | 'Month' | 'Year';
  } | null;
}

export interface Habit {
  title: string;
  scheduled?: string | null;
  description: string;
  repeater?: {
    raw: string;
    frequency?: Record<string, unknown> | null;
  } | null;
  log_entries: Array<{
    date: string;
    state: string;
  }>;
  last_repeat?: string | null;
}

export interface AgendaSnapshot {
  items: AgendaItem[];
  habits: Habit[];
}

export interface CompleteAgendaParams {
  roots: string[];
  roamRoots?: string[];
  path: string;
  headlineLine: number;
}

export interface CaptureRequest {
  roots: string[];
  roamRoots?: string[];
  targetPath: string;
  content: string;
}

export interface SetAgendaStatusParams {
  roots: string[];
  roamRoots?: string[];
  path: string;
  headlineLine: number;
  status: string;
}

export interface AddHabitRequest {
  roots: string[];
  roamRoots?: string[];
  targetPath?: string;
  title: string;
  scheduled: string;
  repeater?: string;
}

export interface DeleteHabitRequest {
  roots: string[];
  roamRoots?: string[];
  path: string;
  title: string;
}

export interface RoamGraph {
  nodes: Array<{
    id: string;
    title: string;
    path: string;
    tags: string[];
  }>;
  links: Array<{
    source: string;
    target: string;
  }>;
}

export interface DocumentRef {
  path: string;
  name: string;
}

export type SlateNode =
  | BlockMetadata & {
      type: 'heading';
      depth: number;
      text: string;
      raw: string;
      todo_keyword?: string | null;
      priority?: string | null;
      tags: string[];
    }
  | BlockMetadata & { type: 'planning'; keyword: string; text: string; raw: string }
  | BlockMetadata & {
      type: 'property_drawer';
      properties: Record<string, string>;
      raw: string;
      collapsed: boolean;
    }
  | BlockMetadata & { type: 'drawer'; name: string; text: string; raw: string; collapsed: boolean }
  | BlockMetadata & { type: 'paragraph'; text: string; raw: string }
  | BlockMetadata & {
      type: 'list_item';
      depth: number;
      ordered: boolean;
      checked?: boolean | null;
      text: string;
      raw: string;
    }
  | BlockMetadata & { type: 'code_block'; language?: string | null; text: string; raw: string }
  | BlockMetadata & { type: 'table'; rows: string[][]; raw: string }
  | BlockMetadata & { type: 'directive'; keyword: string; text: string; raw: string }
  | BlockMetadata & { type: 'horizontal_rule'; raw: string };

export interface BlockMetadata {
  line_start: number;
  line_end: number;
}

export interface DocumentPayload {
  path: string;
  raw: string;
  slate: SlateNode[];
}

export interface UpdateDocumentRequest {
  roots: string[];
  roamRoots?: string[];
  path: string;
  raw: string;
}

type NativeModule = {
  ping(): string;
  load_agenda_snapshot(config: OrgBridgeConfig): AgendaSnapshot;
  complete_agenda_item(params: {
    roots: string[];
    roam_roots?: string[];
    path: string;
    headline_line: number;
  }): AgendaSnapshot;
  append_capture_entry(request: {
    roots: string[];
    roam_roots?: string[];
    target_path: string;
    content: string;
  }): AgendaSnapshot;
  load_roam_graph(config: OrgBridgeConfig): RoamGraph;
  list_documents(config: OrgBridgeConfig): string[];
  load_document(config: OrgBridgeConfig, path: string): DocumentPayload;
  update_document(params: {
    roots: string[];
    roam_roots?: string[];
    path: string;
    raw: string;
  }): DocumentPayload;
  set_roots(config: OrgBridgeConfig): void;
  set_agenda_status(params: {
    roots: string[];
    roam_roots?: string[];
    path: string;
    headline_line: number;
    status: string;
  }): AgendaSnapshot;
};

let cachedBinding: NativeModule | null = null;

export type BridgeEvent = 'agendaChanged' | 'documentsChanged' | 'rootsChanged';

type BridgeListener = () => void;

const bridgeListeners: Record<BridgeEvent, Set<BridgeListener>> = {
  agendaChanged: new Set(),
  documentsChanged: new Set(),
  rootsChanged: new Set()
};

export const E2E_ORG_ROOT = 'postep-e2e://org';

export function isE2EMode(): boolean {
  return getEnv('EXPO_PUBLIC_POSTEP_E2E') === '1' || getEnv('POSTEP_E2E') === '1' || isReactNativeRuntime() || isBrowserRuntime();
}

function isE2EBridge(): boolean {
  return isE2EMode();
}

function isReactNativeRuntime(): boolean {
  const maybeNavigator = globalThis as typeof globalThis & { navigator?: { product?: string } };
  return maybeNavigator.navigator?.product === 'ReactNative';
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getEnv(key: string): string | undefined {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env?.[key];
}

function resolveNativeBinding(): NativeModule {
  if (isE2EBridge()) {
    return e2eNativeModule;
  }
  if (cachedBinding) {
    return cachedBinding;
  }

  const requireNative = eval('require') as NodeRequire;
  const { existsSync } = requireNative('node:fs') as typeof import('node:fs');
  const { join } = requireNative('node:path') as typeof import('node:path');
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
  const localDir = typeof __dirname !== 'undefined' ? __dirname : cwd;
  const candidatePaths = [
    join(localDir, '../native/index.node'),
    join(localDir, '../../../target/debug/org_bridge.node'),
    join(localDir, '../../../target/release/org_bridge.node'),
    join(cwd, 'packages/bridge/native/index.node'),
    join(cwd, 'target/debug/org_bridge.node'),
    join(cwd, 'target/release/org_bridge.node'),
    join(cwd, '../../target/debug/org_bridge.node'),
    join(cwd, '../../target/release/org_bridge.node')
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      cachedBinding = requireNative(candidate) as NativeModule;
      return cachedBinding;
    }
  }

  throw new Error(
    'Unable to locate org_bridge native module. Run `cargo build -p org_bridge` or copy the binary into packages/bridge/native/index.node.'
  );
}

export function ping(): string {
  return resolveNativeBinding().ping();
}

export function loadAgendaSnapshot(config: OrgBridgeConfig): AgendaSnapshot {
  if (config.roots.length === 0) {
    return { items: [], habits: [] };
  }
  const raw = resolveNativeBinding().load_agenda_snapshot(config);
  return normalizeAgendaSnapshot(raw);
}

export function completeAgendaItem(params: CompleteAgendaParams): AgendaSnapshot {
  if (params.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const raw = resolveNativeBinding().complete_agenda_item({
    roots: params.roots,
    roam_roots: params.roamRoots,
    path: params.path,
    headline_line: params.headlineLine
  });
  emitBridgeEvent('agendaChanged');
  return normalizeAgendaSnapshot(raw);
}

export function appendCaptureEntry(request: CaptureRequest): AgendaSnapshot {
  if (request.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const raw = resolveNativeBinding().append_capture_entry({
    roots: request.roots,
    roam_roots: request.roamRoots,
    target_path: request.targetPath,
    content: request.content
  });
  emitBridgeEvent('agendaChanged');
  emitBridgeEvent('documentsChanged');
  return normalizeAgendaSnapshot(raw);
}

export function loadRoamGraph(config: OrgBridgeConfig): RoamGraph {
  if (!config.roamRoots || config.roamRoots.length === 0) {
    return { nodes: [], links: [] };
  }
  return resolveNativeBinding().load_roam_graph(config);
}

export function listDocuments(config: OrgBridgeConfig): DocumentRef[] {
  if (config.roots.length === 0) {
    return [];
  }
  const entries = resolveNativeBinding().list_documents(config);
  return entries.map((path) => ({
    path,
    name: path.split(/[\\/]/).pop() ?? path
  }));
}

export function loadDocument(config: OrgBridgeConfig, path: string): DocumentPayload {
  if (config.roots.length === 0) {
    return { path, raw: '', slate: [] };
  }
  return resolveNativeBinding().load_document(config, path);
}

export function updateDocument(request: UpdateDocumentRequest): DocumentPayload {
  if (request.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const payload = resolveNativeBinding().update_document({
    roots: request.roots,
    roam_roots: request.roamRoots,
    path: request.path,
    raw: request.raw
  });
  emitBridgeEvent('documentsChanged');
  emitBridgeEvent('agendaChanged');
  return payload;
}

export const EMPTY_CONFIG: OrgBridgeConfig = { roots: [] };

export function subscribeBridgeEvent(event: BridgeEvent, listener: BridgeListener): () => void {
  const bucket = bridgeListeners[event];
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
  };
}

export function emitBridgeEvent(event: BridgeEvent): void {
  bridgeListeners[event].forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('bridge listener failed', error);
    }
  });
}

export function setRoots(config: OrgBridgeConfig): void {
  resolveNativeBinding().set_roots(config);
  emitBridgeEvent('rootsChanged');
  emitBridgeEvent('documentsChanged');
}

export function setAgendaStatus(params: SetAgendaStatusParams): AgendaSnapshot {
  if (params.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const raw = resolveNativeBinding().set_agenda_status({
    roots: params.roots,
    roam_roots: params.roamRoots,
    path: params.path,
    headline_line: params.headlineLine,
    status: params.status
  });
  emitBridgeEvent('agendaChanged');
  return normalizeAgendaSnapshot(raw);
}

export function addHabit(request: AddHabitRequest): AgendaSnapshot {
  if (request.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const targetPath = request.targetPath ?? 'habits.org';
  const repeater = request.repeater ?? '+1d';
  const content = `* TODO ${request.title}\nSCHEDULED: <${request.scheduled} ${repeater}>\n:PROPERTIES:\n:STYLE: habit\n:END:\n`;
  return appendCaptureEntry({
    roots: request.roots,
    roamRoots: request.roamRoots,
    targetPath,
    content
  });
}

export function deleteHabit(request: DeleteHabitRequest): AgendaSnapshot {
  if (request.roots.length === 0) {
    throw new Error('No Org roots configured');
  }
  const doc = loadDocument({ roots: request.roots, roamRoots: request.roamRoots }, request.path);
  const nextRaw = removeHabitBlock(doc.raw, request.title);
  updateDocument({
    roots: request.roots,
    roamRoots: request.roamRoots,
    path: request.path,
    raw: nextRaw
  });
  return loadAgendaSnapshot({ roots: request.roots, roamRoots: request.roamRoots });
}

function removeHabitBlock(raw: string, title: string): string {
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => line.startsWith('*') && line.includes(title));
  if (start < 0) {
    return raw;
  }
  let end = lines.length;
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    if (/^\*+\s+/.test(lines[idx])) {
      end = idx;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function normalizeAgendaSnapshot(snapshot: AgendaSnapshot): AgendaSnapshot {
  return {
    items: (snapshot.items ?? []).map(normalizeAgendaItem),
    habits: (snapshot.habits ?? []).map(normalizeHabit)
  };
}

function normalizeAgendaItem(item: AgendaItem): AgendaItem {
  return {
    ...item,
    date: item.date ?? null,
    time: item.time ?? null,
    todo_keyword: item.todo_keyword ?? null,
    timestamp_raw: item.timestamp_raw ?? null,
    repeater: item.repeater ?? null
  };
}

function normalizeHabit(habit: Habit): Habit {
  return {
    ...habit,
    scheduled: habit.scheduled ?? null,
    repeater: habit.repeater ?? null,
    last_repeat: habit.last_repeat ?? null
  };
}

const e2eDocs = new Map<string, string>();


function weekdayName(year: number, month: number, day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function timestampDate(text?: string | null): string | null {
  if (!text) {
    return null;
  }
  return text.replace(/[<>]/g, '').slice(0, 10);
}

function ensureE2EDocs(): void {
  if (e2eDocs.size > 0) {
    return;
  }
  for (let index = 1; index <= 10; index += 1) {
    const day = String(index).padStart(2, '0');
    const scheduledDow = weekdayName(2026, 5, index);
    const deadlineDow = weekdayName(2026, 6, index);
    const raw = `#+TITLE: E2E Org Sample ${index}
#+CATEGORY: postep-e2e
* TODO [#A] Morning habit ${index} :habit:daily:
SCHEDULED: <2026-05-${day} ${scheduledDow} 06:30 +1d>
:PROPERTIES:
:STYLE: habit
:LAST_REPEAT: [2026-05-${day} Thu]
:END:
:LOGBOOK:
- State "DONE" from "TODO" [2026-05-${day} Thu]
:END:
- [ ] open app workflow ${index}
- [X] render org blocks ${index}

* WAITING Agenda item ${index} :agenda:
DEADLINE: <2026-06-${day} ${deadlineDow} 09:00>
Common agenda text for full launched UI automation ${index}.
[[sample-${String(index === 10 ? 1 : index + 1).padStart(2, '0')}]]

* Notes ${index}
| Metric | Budget |
| Move | 8ms |
#+BEGIN_SRC shell
echo e2e-${index}
#+END_SRC
`;
    e2eDocs.set(`${E2E_ORG_ROOT}/sample-${day}.org`, raw);
  }
}

const e2eNativeModule: NativeModule = {
  ping: () => 'postep-org-bridge-e2e',
  load_agenda_snapshot: () => buildE2EAgendaSnapshot(),
  complete_agenda_item: ({ path, headline_line }) => {
    setE2EHeadlineStatus(path, headline_line, 'DONE');
    return buildE2EAgendaSnapshot();
  },
  append_capture_entry: ({ target_path, content }) => {
    ensureE2EDocs();
    const path = target_path.includes('://') ? target_path : `${E2E_ORG_ROOT}/${target_path}`;
    const previous = e2eDocs.get(path) ?? '';
    e2eDocs.set(path, `${previous}${previous.endsWith('\n') || previous.length === 0 ? '' : '\n'}${content}\n`);
    return buildE2EAgendaSnapshot();
  },
  load_roam_graph: () => buildE2ERoamGraph(),
  list_documents: () => {
    ensureE2EDocs();
    return [...e2eDocs.keys()].sort();
  },
  load_document: (_config, path) => loadE2EDocument(path),
  update_document: ({ path, raw }) => {
    ensureE2EDocs();
    e2eDocs.set(path, raw);
    return loadE2EDocument(path);
  },
  set_roots: () => {
    ensureE2EDocs();
  },
  set_agenda_status: ({ path, headline_line, status }) => {
    setE2EHeadlineStatus(path, headline_line, status);
    return buildE2EAgendaSnapshot();
  }
};

function loadE2EDocument(path: string): DocumentPayload {
  ensureE2EDocs();
  const raw = e2eDocs.get(path) ?? '';
  return { path, raw, slate: rawToSlate(raw) };
}

function buildE2ERoamGraph(): RoamGraph {
  ensureE2EDocs();
  const nodes = [...e2eDocs.keys()].map((path) => {
    const id = path.split('/').pop()?.replace(/\.org$/, '') ?? path;
    const raw = e2eDocs.get(path) ?? '';
    const title = raw.match(/^#\+TITLE:\s*(.*)$/m)?.[1] ?? id;
    const tags = [...raw.matchAll(/:([A-Za-z0-9_@#%:]+):/g)].flatMap((match) => match[1].split(':').filter(Boolean));
    return { id, title, path, tags: [...new Set(tags)] };
  });
  const knownIds = new Set(nodes.map((node) => node.id));
  const links = [...e2eDocs.entries()].flatMap(([path, raw]) => {
    const source = path.split('/').pop()?.replace(/\.org$/, '') ?? path;
    return [...raw.matchAll(/\[\[([^\]]+)\]\]/g)]
      .map((match) => match[1])
      .filter((target) => knownIds.has(target))
      .map((target) => ({ source, target }));
  });
  return { nodes, links };
}

function buildE2EAgendaSnapshot(): AgendaSnapshot {
  ensureE2EDocs();
  const items: AgendaItem[] = [];
  const habits: Habit[] = [];
  for (const [path, raw] of e2eDocs) {
    const nodes = rawToSlate(raw);
    for (const heading of nodes.filter((node): node is Extract<SlateNode, { type: 'heading' }> => node.type === 'heading')) {
      const nextHeading = nodes.find((node) => node.type === 'heading' && node.line_start > heading.line_start);
      const bodyNodes = nodes.filter((node) => node.line_start > heading.line_start && (!nextHeading || node.line_start < nextHeading.line_start));
      const scheduled = bodyNodes.find((node): node is Extract<SlateNode, { type: 'planning' }> => node.type === 'planning' && node.keyword === 'SCHEDULED');
      const deadline = bodyNodes.find((node): node is Extract<SlateNode, { type: 'planning' }> => node.type === 'planning' && node.keyword === 'DEADLINE');
      const propertyDrawer = bodyNodes.find((node): node is Extract<SlateNode, { type: 'property_drawer' }> => node.type === 'property_drawer');
      const styleHabit = propertyDrawer?.properties.STYLE?.toLowerCase() === 'habit';
      const planning = scheduled ?? deadline;
      const kind = scheduled ? 'Scheduled' : deadline ? 'Deadline' : 'Floating';
      const context = bodyNodes
        .flatMap((node) => {
          if (node.type === 'paragraph' || node.type === 'list_item') return [node.text];
          if (node.type === 'table') return [node.rows.map((row) => row.join(' · ')).join('\n')];
          return [];
        })
        .filter(Boolean)
        .slice(0, 3)
        .join('\n');
      items.push({
        title: heading.text,
        date: timestampDate(planning?.text) ?? null,
        time: planning?.text?.match(/\b\d{2}:\d{2}\b/)?.[0] ?? null,
        context,
        path,
        headline_line: heading.line_start,
        todo_keyword: heading.todo_keyword,
        kind,
        timestamp_raw: planning?.text ?? null,
        repeater: planning?.text?.includes('+1d') ? { amount: 1, unit: 'Day' } : null
      });
      if (styleHabit) {
        habits.push({
          title: `${heading.todo_keyword ? `${heading.todo_keyword} ` : ''}${heading.text}`,
          scheduled: timestampDate(scheduled?.text) ?? null,
          description: bodyNodes.filter((node) => node.type === 'list_item').map((node) => `- ${node.text}`).join('\n'),
          repeater: { raw: '+1d', frequency: { Daily: 1 } },
          log_entries: [{ date: timestampDate(scheduled?.text) ?? '2026-05-01', state: 'DONE' }],
          last_repeat: propertyDrawer?.properties.LAST_REPEAT?.match(/\[(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
        });
      }
    }
  }
  return { items, habits };
}

function setE2EHeadlineStatus(path: string, headlineLine: number, status: string): void {
  const doc = loadE2EDocument(path);
  const lines = doc.raw.split('\n');
  const line = lines[headlineLine];
  const heading = parseHeading(line);
  if (!line || !heading) {
    return;
  }
  const stars = line.match(/^(\*+)\s+/)?.[1] ?? '*';
  const tags = heading.tags.length > 0 ? ` :${heading.tags.join(':')}:` : '';
  const priority = heading.priority ? `[#${heading.priority}] ` : '';
  lines[headlineLine] = `${stars} ${status} ${priority}${heading.text}${tags}`;
  e2eDocs.set(path, lines.join('\n'));
}

function rawToSlate(raw: string): SlateNode[] {
  const lines = raw.split('\n');
  const nodes: SlateNode[] = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (!trimmed) {
      idx += 1;
      continue;
    }
    const heading = parseHeading(line);
    if (heading) {
      nodes.push({
        type: 'heading',
        depth: heading.depth,
        text: heading.text,
        raw: line,
        todo_keyword: heading.todo_keyword,
        priority: heading.priority,
        tags: heading.tags,
        line_start: idx,
        line_end: idx
      });
      idx += 1;
      continue;
    }
    const planning = trimmed.match(/^(SCHEDULED|DEADLINE|CLOSED):\s+(.*)$/);
    if (planning) {
      nodes.push({ type: 'planning', keyword: planning[1], text: planning[2], raw: line, line_start: idx, line_end: idx });
      idx += 1;
      continue;
    }
    if (trimmed === ':PROPERTIES:') {
      const start = idx;
      const properties: Record<string, string> = {};
      const rawLines = [line];
      idx += 1;
      while (idx < lines.length) {
        rawLines.push(lines[idx]);
        const property = lines[idx].trim().match(/^:([^:]+):\s*(.*)$/);
        if (property && property[1] !== 'END') {
          properties[property[1]] = property[2];
        }
        if (lines[idx].trim() === ':END:') {
          idx += 1;
          break;
        }
        idx += 1;
      }
      nodes.push({
        type: 'property_drawer',
        properties,
        raw: rawLines.join('\n'),
        collapsed: true,
        line_start: start,
        line_end: idx - 1
      });
      continue;
    }
    const drawer = trimmed.match(/^:([A-Z0-9_+-]+):$/i);
    if (drawer && drawer[1].toUpperCase() !== 'END') {
      const start = idx;
      const rawLines = [line];
      const body: string[] = [];
      idx += 1;
      while (idx < lines.length) {
        rawLines.push(lines[idx]);
        if (lines[idx].trim().toUpperCase() === ':END:') {
          idx += 1;
          break;
        }
        body.push(lines[idx]);
        idx += 1;
      }
      nodes.push({
        type: 'drawer',
        name: drawer[1].toUpperCase(),
        text: body.join('\n'),
        raw: rawLines.join('\n'),
        collapsed: true,
        line_start: start,
        line_end: idx - 1
      });
      continue;
    }
    const list = line.match(/^(\s*)([-+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (list) {
      nodes.push({
        type: 'list_item',
        depth: Math.floor(list[1].length / 2) + 1,
        ordered: /\d/.test(list[2]),
        checked: list[3] ? /x/i.test(list[3]) : null,
        text: list[4],
        raw: line,
        line_start: idx,
        line_end: idx
      });
      idx += 1;
      continue;
    }
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const start = idx;
      const rawLines: string[] = [];
      const rows: string[][] = [];
      while (idx < lines.length && lines[idx].trim().startsWith('|') && lines[idx].trim().endsWith('|')) {
        rawLines.push(lines[idx]);
        rows.push(lines[idx].trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
        idx += 1;
      }
      nodes.push({ type: 'table', rows, raw: rawLines.join('\n'), line_start: start, line_end: idx - 1 });
      continue;
    }
    if (/^#\+BEGIN_SRC/i.test(trimmed)) {
      const start = idx;
      const language = trimmed.split(/\s+/)[1] ?? null;
      const rawLines = [line];
      const body: string[] = [];
      idx += 1;
      while (idx < lines.length) {
        rawLines.push(lines[idx]);
        if (/^#\+END_SRC/i.test(lines[idx].trim())) {
          idx += 1;
          break;
        }
        body.push(lines[idx]);
        idx += 1;
      }
      nodes.push({ type: 'code_block', language, text: body.join('\n'), raw: rawLines.join('\n'), line_start: start, line_end: idx - 1 });
      continue;
    }
    if (trimmed.startsWith('#+')) {
      const [keyword, ...rest] = trimmed.slice(2).split(':');
      nodes.push({ type: 'directive', keyword, text: rest.join(':').trim(), raw: line, line_start: idx, line_end: idx });
      idx += 1;
      continue;
    }
    nodes.push({ type: 'paragraph', text: trimmed, raw: line, line_start: idx, line_end: idx });
    idx += 1;
  }
  return nodes;
}

function parseHeading(line: string): null | {
  depth: number;
  text: string;
  todo_keyword: string | null;
  priority: string | null;
  tags: string[];
} {
  const match = line.match(/^(\*+)\s+(.*)$/);
  if (!match) {
    return null;
  }
  let content = match[2].trim();
  let tags: string[] = [];
  const tagMatch = content.match(/\s+:([^\s]+):$/);
  if (tagMatch) {
    tags = tagMatch[1].split(':').filter(Boolean);
    content = content.slice(0, tagMatch.index).trim();
  }
  let todo_keyword: string | null = null;
  const todoMatch = content.match(/^([A-Z][A-Z_-]*)\s+(.*)$/);
  if (todoMatch) {
    todo_keyword = todoMatch[1];
    content = todoMatch[2].trim();
  }
  let priority: string | null = null;
  const priorityMatch = content.match(/^\[#([A-Z])\]\s+(.*)$/);
  if (priorityMatch) {
    priority = priorityMatch[1];
    content = priorityMatch[2].trim();
  }
  return { depth: match[1].length, text: content, todo_keyword, priority, tags };
}

function findNextHeading(lines: string[], start: number): number {
  for (let idx = start; idx < lines.length; idx += 1) {
    if (/^\*+\s+/.test(lines[idx])) {
      return idx;
    }
  }
  return lines.length;
}
