import type { AgendaItem, Habit } from '@postep/bridge';
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

export function selectRoute(currentRoute: string, nextRoute: string): string {
  return currentRoute === nextRoute ? currentRoute : nextRoute;
}

export function budgeted<T>(name: keyof typeof MAIN_FEATURE_BUDGET_MS, fn: () => T): WorkflowBudgetResult<T> {
  const measured = measureInteraction(name, fn);
  return { ...measured, budgetMs: MAIN_FEATURE_BUDGET_MS[name] };
}
