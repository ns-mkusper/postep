import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  archiveHeading,
  copyHeadingBlock,
  cutHeadingBlock,
  findHeadingRange,
  headingChoices,
  insertHeading,
  moveHeading,
  pasteHeadingBlock,
  refileHeadingUnder,
  setHeadingPriority,
  setHeadingState,
  setHeadingTags,
  setPlanningTimestamp,
  timestampShortcut
} from '../lib/orgDocumentActions';

const sample = `#+TITLE: Sample
* TODO [#A] Alpha :work:
Body alpha
** NEXT Child
Child body
* Beta
Beta body
* DONE Gamma :old:
Gamma body`;

describe('org document heading actions', () => {
  it('finds, copies, and cuts a full subtree', () => {
    const range = findHeadingRange(sample, 3);
    assert.deepEqual(range, { start: 3, end: 4, depth: 2, line: '** NEXT Child' });
    assert.equal(copyHeadingBlock(sample, 1), '* TODO [#A] Alpha :work:\nBody alpha\n** NEXT Child\nChild body');

    const cut = cutHeadingBlock(sample, 1);
    assert.equal(cut.block, '* TODO [#A] Alpha :work:\nBody alpha\n** NEXT Child\nChild body');
    assert.equal(cut.raw, '#+TITLE: Sample\n* Beta\nBeta body\n* DONE Gamma :old:\nGamma body');
  });

  it('pastes headings above, under, and below with normalized depth', () => {
    const block = '* Copied\n** Child';
    assert.match(pasteHeadingBlock(sample, block, 5, 'above'), /\* Copied\n\*\* Child\n\* Beta/);
    assert.match(pasteHeadingBlock(sample, block, 5, 'below'), /Beta body\n\* Copied\n\*\* Child\n\* DONE Gamma/);
    assert.match(pasteHeadingBlock(sample, block, 5, 'under'), /\* Beta\n\*\* Copied\n\*\*\* Child\nBeta body/);
  });

  it('inserts headings above, under, and below the selected item', () => {
    assert.match(insertHeading(sample, 'Before beta', 5, 'above'), /\* Before beta\n\* Beta/);
    assert.match(insertHeading(sample, 'Inside beta', 5, 'under'), /\* Beta\n\*\* Inside beta\nBeta body/);
    assert.match(insertHeading(sample, 'After beta', 5, 'below'), /Beta body\n\* After beta\n\* DONE Gamma/);
  });

  it('sets state, priority, tags, archive tag, and planning timestamps', () => {
    assert.match(setHeadingState(sample, 1, 'DONE'), /\* DONE \[#A\] Alpha :work:/);
    assert.match(setHeadingState(sample, 1, null), /\* \[#A\] Alpha :work:/);
    assert.match(setHeadingPriority(sample, 5, 'B'), /\* \[#B\] Beta/);
    assert.match(setHeadingPriority(sample, 1, null), /\* TODO Alpha :work:/);
    assert.match(setHeadingTags(sample, 5, ['home', 'next']), /\* Beta :home:next:/);
    assert.match(archiveHeading(sample, 5), /\* Beta :ARCHIVE:/);

    const scheduled = setPlanningTimestamp(sample, 5, 'SCHEDULED', '<2026-06-12 Fri>');
    assert.match(scheduled, /\* Beta\nSCHEDULED: <2026-06-12 Fri>\nBeta body/);
    assert.equal(setPlanningTimestamp(scheduled, 5, 'SCHEDULED', null).includes('SCHEDULED:'), false);
  });

  it('moves headings vertically and changes outline depth', () => {
    assert.ok(moveHeading(sample, 5, 'up').indexOf('* Beta') < moveHeading(sample, 5, 'up').indexOf('* TODO'));
    assert.match(moveHeading(sample, 5, 'demote'), /\*\* Beta/);
    assert.match(moveHeading(sample, 3, 'promote'), /^\* NEXT Child/m);
  });

  it('refiles under another heading and blocks self-subtree targets', () => {
    const refiled = refileHeadingUnder(sample, 5, 1);
    assert.match(refiled, /\* TODO \[#A\] Alpha :work:\n\*\* Beta\nBeta body\nBody alpha/);
    assert.equal(refileHeadingUnder(sample, 1, 3), sample);
  });

  it('lists heading choices and creates deterministic timestamp shortcuts', () => {
    assert.deepEqual(headingChoices(sample).map((heading) => heading.title), ['Alpha', 'Child', 'Beta', 'Gamma']);
    assert.equal(timestampShortcut('today', new Date(2026, 5, 12)), '<2026-06-12 Fri>');
    assert.equal(timestampShortcut('tomorrow', new Date(2026, 5, 12)), '<2026-06-13 Sat>');
  });
});
