import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEditor } from 'lexical';

import { ping, loadAgendaSnapshot, AgendaSnapshot } from '../src/index.js';

type HarnessNode = { type: 'paragraph'; children: Array<{ text: string }> };

function buildDoc(snapshot: AgendaSnapshot, bridgePing: string): HarnessNode[] {
  const agendaLines = snapshot.items.map((item) => `${item.kind}: ${item.title}`);
  const habitLines = snapshot.habits.map((habit) => `Habit: ${habit.title}`);

  return [
    { type: 'paragraph', children: [{ text: bridgePing }] },
    { type: 'paragraph', children: [{ text: 'Agenda Preview' }] },
    ...agendaLines.map((line) => ({ type: 'paragraph' as const, children: [{ text: line }] })),
    { type: 'paragraph', children: [{ text: 'Habits Preview' }] },
    ...habitLines.map((line) => ({ type: 'paragraph' as const, children: [{ text: line }] }))
  ];
}

async function main() {
  const namespace = 'postep-bridge-harness';
  createEditor({ namespace });

  let snapshot: AgendaSnapshot;
  let bridgePing = 'bridge-not-built';

  try {
    bridgePing = ping();
    snapshot = loadAgendaSnapshot({ roots: [] });
  } catch (error) {
    console.warn('Falling back to mock snapshot for Lexical harness:', error);
    snapshot = {
      items: [
        {
          title: 'Review daily plan',
          context: 'Mock data',
          path: '<demo>',
          headline_line: 0,
          kind: 'Scheduled'
        }
      ],
      habits: [
        {
          title: 'Evening reflection',
          description: 'Log wins and lessons',
          log_entries: []
        }
      ]
    } as AgendaSnapshot;
  }

  const doc = buildDoc(snapshot, bridgePing);

  const markup = renderToStaticMarkup(
    <section data-lexical-namespace={namespace}>
      <pre>{JSON.stringify(doc, null, 2)}</pre>
    </section>
  );

  console.log('\nLexical Harness Rendered Markup:\n');
  console.log(markup);
}

main().catch((error) => {
  console.error('Failed to run Lexical harness', error);
  process.exitCode = 1;
});
