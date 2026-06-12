import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { performance } from 'node:perf_hooks';

import type { LexicalNode } from '@postep/bridge';
import {
  INTERACTION_BUDGET_MS,
  createBlockViewModels,
  createOrgLexicalDocument,
  moveRawBlock,
  lexicalNodesToProjection,
  orgProjectionPlainText,
  updateRawBlock
} from '../lib/orgLexicalModel';

declare const globalThis: typeof global & { performance?: Performance };
globalThis.performance = performance as unknown as Performance;

const samples = Array.from({ length: 10 }, (_, idx) => {
  const day = String(idx + 1).padStart(2, '0');
  return `#+TITLE: UX Sample ${idx + 1}
* TODO [#A] Habit ${idx + 1} :habit:mobile:
SCHEDULED: <2026-05-${day} Thu +1d>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
- State "DONE" from "TODO" [2026-05-${day} Thu]
:END:
- [ ] complete app render pass
- [X] keep block edits instant

* WAITING Agenda item ${idx + 1} :agenda:
DEADLINE: <2026-06-${day} Mon 09:00>
Common agenda text with [[id:sample-${idx}]][sample link]].

* Notes ${idx + 1}
| Metric | Budget |
| Move | 8ms |
#+BEGIN_SRC shell
echo sample-${idx}
#+END_SRC
`;
});

function syntheticLexical(raw: string): LexicalNode[] {
  return raw.split('\n').flatMap((line, idx): LexicalNode[] => {
    const heading = line.match(/^(\*+)\s+(?:(TODO|WAITING|DONE)\s+)?(?:\[#([A-Z])\]\s+)?(.*?)(\s+:[^\s]+:)?$/);
    if (heading) {
      return [
        {
          type: 'heading',
          depth: heading[1].length,
          text: heading[4].trim(),
          raw: line,
          line_start: idx,
          line_end: idx,
          todo_keyword: heading[2] ?? null,
          priority: heading[3] ?? null,
          tags: (heading[5] ?? '')
            .trim()
            .split(':')
            .filter(Boolean)
        }
      ];
    }
    if (/^SCHEDULED:|^DEADLINE:/.test(line)) {
      const [keyword, ...rest] = line.split(':');
      return [{ type: 'planning', keyword, text: rest.join(':').trim(), raw: line, line_start: idx, line_end: idx }];
    }
    const list = line.match(/^\s*[-+]\s+(\[[ xX]\]\s+)?(.*)$/);
    if (list) {
      return [
        {
          type: 'list_item',
          depth: 1,
          ordered: false,
          checked: list[1] ? /x/i.test(list[1]) : null,
          text: list[2],
          raw: line,
          line_start: idx,
          line_end: idx
        }
      ];
    }
    return [];
  });
}

function timed<T>(fn: () => T): { value: T; elapsedMs: number } {
  const start = performance.now();
  const value = fn();
  return { value, elapsedMs: performance.now() - start };
}

describe('org UI interaction model with 10 local org samples', () => {
  it('projects rendered blocks inside the tight lexical projection budget', () => {
    const { value: allBlocks, elapsedMs } = timed(() =>
      samples.flatMap((raw) => createBlockViewModels(syntheticLexical(raw), raw, { outlineOnly: false, readerMode: true }))
    );
    assert.ok(allBlocks.length >= 50);
    assert.ok(elapsedMs <= INTERACTION_BUDGET_MS.lexicalProjection, `projection took ${elapsedMs}ms`);
  });

  it('moves individual org blocks within the UX budget', () => {
    const raw = samples[0];
    const heading = syntheticLexical(raw).find((node) => node.type === 'heading' && node.text.includes('Agenda item'))!;
    const { value: moved, elapsedMs } = timed(() => moveRawBlock(raw, heading, -1));
    assert.notEqual(moved, raw);
    assert.ok(moved.indexOf('Agenda item') < moved.indexOf('Habit 1'));
    assert.ok(elapsedMs <= INTERACTION_BUDGET_MS.blockMove, `move took ${elapsedMs}ms`);
  });

  it('edits individual org blocks within the UX budget', () => {
    const raw = samples[1];
    const listItem = syntheticLexical(raw).find((node) => node.type === 'list_item' && node.text.includes('render pass'))!;
    const { value: edited, elapsedMs } = timed(() => updateRawBlock(raw, listItem, '- [X] complete app render pass'));
    assert.ok(edited.includes('- [X] complete app render pass'));
    assert.ok(elapsedMs <= INTERACTION_BUDGET_MS.blockEdit, `edit took ${elapsedMs}ms`);
  });

  it('keeps read-mode projection generation within budget after common toggles', () => {
    const nodes = samples.flatMap(syntheticLexical);
    const { value: projection, elapsedMs } = timed(() =>
      lexicalNodesToProjection(nodes, samples.join('\n'), { outlineOnly: false, readerMode: true })
    );
    assert.ok(projection.length >= 50);
    assert.ok(elapsedMs <= INTERACTION_BUDGET_MS.lexicalProjection, `projection took ${elapsedMs}ms`);
  });

  it('builds full Lexical document projections with org editor metadata in budget', () => {
    const nodes: LexicalNode[] = [
      {
        type: 'heading',
        depth: 1,
        text: 'Morning habit :habit:daily:',
        raw: '* TODO [#A] Morning habit :habit:daily:',
        line_start: 0,
        line_end: 0,
        todo_keyword: 'TODO',
        priority: 'A',
        tags: ['habit', 'daily']
      },
      {
        type: 'planning',
        keyword: 'SCHEDULED',
        text: '<2026-06-12 Fri 06:30 +1d>',
        raw: 'SCHEDULED: <2026-06-12 Fri 06:30 +1d>',
        line_start: 1,
        line_end: 1
      },
      {
        type: 'property_drawer',
        properties: { STYLE: 'habit', EFFORT: '0:05' },
        raw: ':PROPERTIES:\n:STYLE: habit\n:EFFORT: 0:05\n:END:',
        line_start: 2,
        line_end: 5
      },
      {
        type: 'list_item',
        depth: 2,
        ordered: false,
        checked: false,
        text: 'open app workflow',
        raw: '  - [ ] open app workflow',
        line_start: 6,
        line_end: 6
      },
      {
        type: 'table',
        rows: [['Metric', 'Budget'], ['Fold', 'responsive']],
        raw: '| Metric | Budget |\n| Fold | responsive |',
        line_start: 7,
        line_end: 8
      },
      {
        type: 'code_block',
        language: 'shell',
        text: 'echo responsive',
        raw: '#+BEGIN_SRC shell\necho responsive\n#+END_SRC',
        line_start: 9,
        line_end: 11
      }
    ];

    const { value: document, elapsedMs } = timed(() =>
      createOrgLexicalDocument(nodes, samples[0], { outlineOnly: false, readerMode: true })
    );

    assert.ok(elapsedMs <= INTERACTION_BUDGET_MS.lexicalProjection, `document creation took ${elapsedMs}ms`);
    assert.equal(document.projection.length, nodes.length);
    const heading = document.projection[0];
    assert.equal(heading.type, 'heading');
    if (heading.type !== 'heading') {
      assert.fail('expected heading projection');
    }
    assert.equal(heading.todo, 'TODO');
    assert.equal(heading.priority, 'A');
    assert.deepEqual(heading.tags, ['habit', 'daily']);
    assert.equal(orgProjectionPlainText(heading), '* TODO [#A] Morning habit :habit:daily:');

    const propertyDrawer = document.projection[2];
    assert.equal(propertyDrawer.type, 'property_drawer');
    if (propertyDrawer.type !== 'property_drawer') {
      assert.fail('expected property drawer projection');
    }
    assert.deepEqual(propertyDrawer.properties, { STYLE: 'habit', EFFORT: '0:05' });
    assert.match(orgProjectionPlainText(document.projection[4]), /^\| Metric \| Budget \|/);
  });
});
