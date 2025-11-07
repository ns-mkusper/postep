import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list_item'; depth: number; ordered: boolean; text: string };

export interface DocumentPayload {
  path: string;
  raw: string;
  slate: SlateNode[];
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
const requireNative = createRequire(import.meta.url);

export type BridgeEvent = 'agendaChanged' | 'documentsChanged' | 'rootsChanged';

type BridgeListener = () => void;

const bridgeListeners: Record<BridgeEvent, Set<BridgeListener>> = {
  agendaChanged: new Set(),
  documentsChanged: new Set(),
  rootsChanged: new Set()
};

function resolveNativeBinding(): NativeModule {
  if (cachedBinding) {
    return cachedBinding;
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    join(__dirname, '../native/index.node'),
    join(__dirname, '../../../target/debug/org_bridge.node'),
    join(__dirname, '../../../target/release/org_bridge.node')
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
