import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseOrgDocument } from '../../../packages/bridge/src/index';

describe('bridge org parser', () => {
  it('normalizes visually indented headings before notes previews render them', () => {
    const document = parseOrgDocument(`  * TODO [#A] take ownership of folder :windows:
    ** open input file
Body text`, 'windows.org');

    const headings = document.lexical.filter((node) => node.type === 'heading');
    assert.equal(headings.length, 2);
    assert.deepEqual(
      headings.map((node) => node.text),
      ['take ownership of folder', 'open input file']
    );
    assert.equal(headings[0].todo_keyword, 'TODO');
    assert.equal(headings[0].priority, 'A');
    assert.deepEqual(headings[0].tags, ['windows']);
  });
});
