import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { performance } from 'node:perf_hooks';

import type { AgendaItem, Habit, RoamGraph } from '@postep/bridge';
import { createBlockViewModels } from '../lib/orgLexicalModel';
import {
  addHabitBlock,
  appendCapture,
  budgeted,
  buildRoamExplorerWorkflow,
  buildRoamModeView,
  deleteHabitBlock,
  groupAgendaByDay,
  replaceHeadlineStatus,
  selectRoute,
  summarizeHabits
} from '../lib/mainFeatureWorkflows';

declare const globalThis: typeof global & { performance?: Performance };
globalThis.performance = performance as unknown as Performance;

const rawDocs = Array.from({ length: 10 }, (_, idx) => {
  const day = String(idx + 1).padStart(2, '0');
  return `* TODO [#A] Morning habit ${idx + 1} :habit:daily:
SCHEDULED: <2026-05-${day} Thu 06:30 +1d>
:PROPERTIES:
:STYLE: habit
:END:
- [ ] open app
- [X] render org blocks

* WAITING Agenda item ${idx + 1} :agenda:
DEADLINE: <2026-06-${day} Mon 09:00>
Common agenda text.
`;
});

const agendaItems: AgendaItem[] = Array.from({ length: 60 }, (_, idx) => ({
  title: `Agenda item ${idx + 1}`,
  date: `2026-06-${String((idx % 10) + 1).padStart(2, '0')}`,
  time: idx % 2 === 0 ? '09:00' : null,
  context: 'Context text',
  path: `sample-${idx % 10}.org`,
  headline_line: idx,
  todo_keyword: idx % 3 === 0 ? 'WAITING' : 'TODO',
  kind: idx % 2 === 0 ? 'Scheduled' : 'Deadline',
  timestamp_raw: null,
  repeater: null
}));

const habits: Habit[] = Array.from({ length: 10 }, (_, idx) => ({
  title: `TODO Morning habit ${idx + 1}`,
  scheduled: `2026-05-${String(idx + 1).padStart(2, '0')}`,
  description: '- [ ] open app',
  repeater: { raw: '+1d', frequency: { Daily: 1 } },
  log_entries: [{ date: `2026-05-${String(idx + 1).padStart(2, '0')}`, state: 'DONE' }],
  last_repeat: idx === 0 ? '2026-05-10' : `2026-05-${String(idx + 1).padStart(2, '0')}`
}));

const roamGraph: RoamGraph = {
  nodes: Array.from({ length: 10 }, (_, idx) => ({
    id: `sample-${String(idx + 1).padStart(2, '0')}`,
    title: `E2E Org Sample ${idx + 1}`,
    path: idx === 0 ? 'daily/2026-06-01.org' : `sample-${String(idx + 1).padStart(2, '0')}.org`,
    tags: ['habit', idx % 2 === 0 ? 'daily' : 'agenda']
  })),
  links: Array.from({ length: 10 }, (_, idx) => ({
    source: `sample-${String(idx + 1).padStart(2, '0')}`,
    target: `sample-${String(((idx + 1) % 10) + 1).padStart(2, '0')}`
  }))
};

const largeRoamGraph: RoamGraph = {
  nodes: Array.from({ length: 400 }, (_, idx) => ({
    id: `large-${String(idx + 1).padStart(3, '0')}`,
    title: `Large Roam Note ${idx + 1}`,
    path: idx % 14 === 0 ? `daily/2026-06-${String((idx % 28) + 1).padStart(2, '0')}.org` : `large-${idx + 1}.org`,
    tags: [`topic-${idx % 20}`, idx % 3 === 0 ? 'daily' : 'project']
  })),
  links: Array.from({ length: 800 }, (_, idx) => ({
    source: `large-${String((idx % 400) + 1).padStart(3, '0')}`,
    target: `large-${String(((idx * 7 + 13) % 400) + 1).padStart(3, '0')}`
  }))
};

describe('main feature workflows stay inside tight interaction budgets', () => {
  it('opens and projects the 10-file document workspace inside budget', () => {
    const { value, metric, budgetMs } = budgeted('documentOpen', () =>
      rawDocs.flatMap((raw, idx) =>
        createBlockViewModels(
          [
            {
              type: 'heading',
              depth: 1,
              text: `Morning habit ${idx + 1}`,
              raw: raw.split('\n')[0],
              todo_keyword: 'TODO',
              priority: 'A',
              tags: ['habit', 'daily'],
              line_start: 0,
              line_end: 0
            },
            {
              type: 'planning',
              keyword: 'SCHEDULED',
              text: `<2026-05-${String(idx + 1).padStart(2, '0')} Thu 06:30 +1d>`,
              raw: raw.split('\n')[1],
              line_start: 1,
              line_end: 1
            }
          ],
          raw,
          { outlineOnly: false, readerMode: false }
        )
      )
    );
    assert.equal(value.length, 20);
    assert.ok(metric.elapsedMs <= budgetMs, `document open/model projection took ${metric.elapsedMs}ms`);
  });

  it('groups agenda screen data inside budget', () => {
    const { value, metric, budgetMs } = budgeted('agendaGroup', () => groupAgendaByDay(agendaItems));
    assert.equal(value.length, 10);
    assert.ok(metric.elapsedMs <= budgetMs, `agenda grouping took ${metric.elapsedMs}ms`);
  });

  it('updates agenda item status inside budget', () => {
    const { value, metric, budgetMs } = budgeted('agendaStatus', () => replaceHeadlineStatus(rawDocs[0], 0, 'DONE'));
    assert.ok(value.startsWith('* DONE [#A] Morning habit 1'));
    assert.ok(metric.elapsedMs <= budgetMs, `agenda status update took ${metric.elapsedMs}ms`);
  });

  it('captures new inbox content inside budget', () => {
    const { value, metric, budgetMs } = budgeted('captureAppend', () =>
      appendCapture(rawDocs[0], '* TODO Captured from mobile\nSCHEDULED: <2026-06-20 Sat>')
    );
    assert.ok(value.includes('Captured from mobile'));
    assert.ok(metric.elapsedMs <= budgetMs, `capture append took ${metric.elapsedMs}ms`);
  });

  it('summarizes habits screen data inside budget', () => {
    const { value, metric, budgetMs } = budgeted('habitsSummary', () => summarizeHabits(habits, '2026-05-10'));
    assert.equal(value.total, 10);
    assert.equal(value.completedToday, 2);
    assert.ok(metric.elapsedMs <= budgetMs, `habit summary took ${metric.elapsedMs}ms`);
  });

  it('adds and deletes habits inside budget', () => {
    const { value, metric, budgetMs } = budgeted('habitAddDelete', () => {
      const added = addHabitBlock(rawDocs[0], 'Hydrate', '2026-05-15 Fri 08:00');
      return deleteHabitBlock(added, 'Hydrate');
    });
    assert.ok(!value.includes('Hydrate'));
    assert.ok(metric.elapsedMs <= budgetMs, `habit add/delete took ${metric.elapsedMs}ms`);
  });

  it('builds roam graph, backlinks, and tags modes inside budget', () => {
    const { value, metric, budgetMs } = budgeted('roamMode', () => [
      buildRoamModeView(roamGraph, 'graph'),
      buildRoamModeView(roamGraph, 'backlinks', 'sample-01'),
      buildRoamModeView(roamGraph, 'tags')
    ]);
    assert.equal((value[0] as any).nodes, 10);
    assert.ok((value[1] as any).backlinks.length >= 1);
    assert.ok((value[2] as any).tags.habit >= 10);
    assert.ok(metric.elapsedMs <= budgetMs, `roam mode build took ${metric.elapsedMs}ms`);
  });

  it('builds the roam explorer view model with relationships and filters inside budget', () => {
    const { value, metric, budgetMs } = budgeted('roamExplorer', () =>
      buildRoamExplorerWorkflow(roamGraph, {
        selectedId: 'sample-01',
        activeTag: 'daily',
        relationshipFilter: 'linked'
      })
    );
    assert.equal(value.summary.nodes, 10);
    assert.equal(value.selectedNode?.id, 'sample-01');
    assert.ok(value.backlinks.length >= 1);
    assert.ok(value.forwardLinks.length >= 1);
    assert.ok(value.relatedNotes.length >= 1);
    assert.ok(value.tagGroups.some((group) => group.tag === 'daily'));
    assert.equal(value.dailyNotes[0]?.dailyDate, '2026-06-01');
    assert.ok(value.filteredNodes.every((node) => node.tags.includes('daily')));
    assert.ok(metric.elapsedMs <= budgetMs, `roam explorer build took ${metric.elapsedMs}ms`);
  });

  it('keeps large roam graph filtering responsive inside budget', () => {
    const queries = ['large roam note 1', 'topic-7', 'daily', 'project'];
    const { value, metric, budgetMs } = budgeted('roamResponsiveness', () =>
      queries.map((query, idx) =>
        buildRoamExplorerWorkflow(largeRoamGraph, {
          selectedId: `large-${String(idx + 1).padStart(3, '0')}`,
          query,
          activeTag: idx % 2 === 0 ? null : `topic-${idx + 3}`,
          relationshipFilter: idx === 2 ? 'daily' : 'linked'
        })
      )
    );
    assert.equal(value.length, queries.length);
    assert.ok(value.every((view) => view.summary.nodes === 400));
    assert.ok(value.some((view) => view.filteredNodes.length > 0));
    assert.ok(metric.elapsedMs <= budgetMs, `large roam filtering took ${metric.elapsedMs}ms`);
  });

  it('switches between main feature routes inside budget', () => {
    const routes = ['/library', '/agenda', '/habits', '/capture', '/roam', '/library'];
    const { value, metric, budgetMs } = budgeted('routeSwitch', () =>
      routes.reduce((current, next) => selectRoute(current, next), '/agenda')
    );
    assert.equal(value, '/library');
    assert.ok(metric.elapsedMs <= budgetMs, `route switch model took ${metric.elapsedMs}ms`);
  });
});
