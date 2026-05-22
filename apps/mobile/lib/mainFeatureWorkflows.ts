import type { AgendaItem, Habit, RoamGraph } from '@postep/bridge';
import { INTERACTION_BUDGET_MS, type InteractionMetric, measureInteraction } from './orgSlateModel';

export interface AgendaDayGroup {
  date: string;
  list: AgendaItem[];
}

export interface WorkflowBudgetResult<T> {
  value: T;
  metric: InteractionMetric;
  budgetMs: number;
}

export const MAIN_FEATURE_BUDGET_MS = {
  documentOpen: 12,
  agendaGroup: INTERACTION_BUDGET_MS.agendaRefresh,
  agendaStatus: 8,
  captureAppend: 8,
  habitsSummary: 12,
  habitAddDelete: 8,
  roamMode: 12,
  routeSwitch: 6
} as const;

export function groupAgendaByDay(items: AgendaItem[]): AgendaDayGroup[] {
  const groups: Record<string, AgendaItem[]> = {};
  for (const item of items) {
    const key = item.date ?? 'unscheduled';
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
  }
  return Object.entries(groups)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, list]) => ({ date, list }));
}

export function replaceHeadlineStatus(raw: string, headlineLine: number, status: string): string {
  const lines = raw.split('\n');
  const line = lines[headlineLine];
  if (!line || !line.startsWith('*')) {
    return raw;
  }

  const heading = line.match(/^(\*+)\s+(.*)$/);
  if (!heading) {
    return raw;
  }
  const [, stars, rest] = heading;
  const tokens = rest.trim().split(/\s+/);
  const first = tokens[0] ?? '';
  const tail = /^[A-Z][A-Z_-]*$/.test(first) ? rest.trim().slice(first.length).trimStart() : rest.trim();
  lines[headlineLine] = `${stars} ${status}${tail ? ` ${tail}` : ''}`;
  return lines.join('\n');
}

export function appendCapture(raw: string, content: string): string {
  const prefix = raw.length === 0 || raw.endsWith('\n') ? raw : `${raw}\n`;
  return `${prefix}${content.endsWith('\n') ? content : `${content}\n`}`;
}

export function addHabitBlock(raw: string, title: string, scheduled: string, repeater = '+1d'): string {
  return appendCapture(raw, `* TODO ${title}\nSCHEDULED: <${scheduled} ${repeater}>\n:PROPERTIES:\n:STYLE: habit\n:END:`);
}

export function deleteHabitBlock(raw: string, title: string): string {
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

export interface HabitSummary {
  total: number;
  completedToday: number;
  overdue: number;
  latestRepeat?: string | null;
}

export function summarizeHabits(habits: Habit[], today: string): HabitSummary {
  let completedToday = 0;
  let overdue = 0;
  let latestRepeat: string | null | undefined = null;

  for (const habit of habits) {
    if (habit.last_repeat === today || habit.log_entries.some((entry) => entry.date === today && entry.state === 'DONE')) {
      completedToday += 1;
    }
    if (habit.scheduled && habit.scheduled < today && habit.last_repeat !== today) {
      overdue += 1;
    }
    if (habit.last_repeat && (!latestRepeat || habit.last_repeat > latestRepeat)) {
      latestRepeat = habit.last_repeat;
    }
  }

  return { total: habits.length, completedToday, overdue, latestRepeat };
}

export function buildRoamModeView(graph: RoamGraph, mode: 'graph' | 'backlinks' | 'tags', selectedId?: string) {
  if (mode === 'graph') {
    return { mode, nodes: graph.nodes.length, links: graph.links.length };
  }
  if (mode === 'tags') {
    const tags: Record<string, number> = {};
    for (const node of graph.nodes) {
      for (const tag of node.tags) {
        tags[tag] = (tags[tag] ?? 0) + 1;
      }
    }
    return { mode, tags };
  }
  const target = selectedId ?? graph.nodes[0]?.id;
  const backlinks = graph.links
    .filter((link) => link.target === target)
    .map((link) => graph.nodes.find((node) => node.id === link.source))
    .filter(Boolean);
  return { mode, backlinks };
}

export function selectRoute(currentRoute: string, nextRoute: string): string {
  return currentRoute === nextRoute ? currentRoute : nextRoute;
}

export function budgeted<T>(name: keyof typeof MAIN_FEATURE_BUDGET_MS, fn: () => T): WorkflowBudgetResult<T> {
  const measured = measureInteraction(name, fn);
  return { ...measured, budgetMs: MAIN_FEATURE_BUDGET_MS[name] };
}
