import type { LexicalNode } from '@postep/bridge';
import {
  INTERACTION_BUDGET_MS,
  createBlockViewModels,
  lexicalNodesToProjection,
  moveRawBlock,
  updateRawBlock
} from '../lib/orgLexicalModel';
import {
  type EditorFrontendAdapter,
  createEditorFrontendBenchmarkSuite,
  syntheticOrgNodes
} from './support/editorFrontendBenchmark';

const lexicalFrontend: EditorFrontendAdapter<
  LexicalNode,
  ReturnType<typeof lexicalNodesToProjection>[number],
  ReturnType<typeof createBlockViewModels>[number]
> = {
  name: 'lexical',
  budgets: {
    projectionMs: INTERACTION_BUDGET_MS.lexicalProjection,
    blockMoveMs: INTERACTION_BUDGET_MS.blockMove,
    blockEditMs: INTERACTION_BUDGET_MS.blockEdit
  },
  syntheticNodes: syntheticOrgNodes,
  createBlockViewModels: (raw, nodes, options) => createBlockViewModels(nodes, raw, options),
  nodesToProjection: (raw, nodes, options) => lexicalNodesToProjection(nodes, raw, options),
  moveRawBlock,
  updateRawBlock,
  isHeading: (node, textIncludes) => node.type === 'heading' && node.text.includes(textIncludes),
  isListItem: (node, textIncludes) => node.type === 'list_item' && node.text.includes(textIncludes)
};

createEditorFrontendBenchmarkSuite(lexicalFrontend);
