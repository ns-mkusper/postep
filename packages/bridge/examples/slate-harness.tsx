import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEditor, Descendant } from 'slate';
import { Slate, withReact } from 'slate-react';

import { ping, loadAgendaSnapshot, AgendaSnapshot } from '../src/index.js';

function buildDoc(snapshot: AgendaSnapshot, bridgePing: string): Descendant[] {
  const agendaLines = snapshot.items.map((item) => `${item.kind}: ${item.title}`);
  const habitLines = snapshot.habits.map((habit) => `Habit: ${habit.title}`);

  return [
    {
      type: 'paragraph',
      children: [{ text: bridgePing }]
    },
    {
      type: 'paragraph',
      children: [{ text: 'Agenda Preview' }]
    },
    ...agendaLines.map((line) => ({
      type: 'paragraph',
      children: [{ text: line }]
    })),
    {
      type: 'paragraph',
      children: [{ text: 'Habits Preview' }]
    },
    ...habitLines.map((line) => ({
      type: 'paragraph',
      children: [{ text: line }]
    }))
  ];
}

async function main() {
  const editor = withReact(createEditor());

  let snapshot: AgendaSnapshot;
  let bridgePing = 'bridge-not-built';

  try {
    bridgePing = ping();
    snapshot = loadAgendaSnapshot({ roots: [] });
  } catch (error) {
    console.warn('Falling back to mock snapshot for Slate harness:', error);
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
    <Slate editor={editor} value={doc} onChange={() => {}}>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </Slate>
  );

  console.log('\nSlate Harness Rendered Markup:\n');
  console.log(markup);
}

main().catch((error) => {
  console.error('Failed to run Slate harness', error);
  process.exitCode = 1;
});
