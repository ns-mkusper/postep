import type { LexicalNode } from '@postep/bridge';

export type LexicalProjectionNode =
  | { type: 'heading'; depth: number; children: Array<{ text: string }> }
  | { type: 'list_item'; depth: number; ordered: boolean; checked: boolean | null; children: Array<{ text: string }> }
  | { type: 'planning'; children: Array<{ text: string }> }
  | { type: 'property_drawer'; children: Array<{ text: string }> }
  | { type: 'drawer'; children: Array<{ text: string }> }
  | { type: 'code_block'; language?: string | null; children: Array<{ text: string }> }
  | { type: 'table'; rows: string[][]; children: Array<{ text: string }> }
  | { type: 'directive'; children: Array<{ text: string }> }
  | { type: 'horizontal_rule'; children: Array<{ text: string }> }
  | { type: 'paragraph'; children: Array<{ text: string }> };

export interface ConversionOptions {
  outlineOnly: boolean;
  readerMode: boolean;
}

export interface OrgBlockViewModel {
  id: string;
  node: LexicalNode;
  projection: LexicalProjectionNode[];
  displayText: string;
  rawText: string;
}

export interface InteractionMetric {
  name: string;
  elapsedMs: number;
}

export const INTERACTION_BUDGET_MS = {
  blockMove: 8,
  blockEdit: 8,
  lexicalProjection: 12,
  agendaRefresh: 50
} as const;

export function lexicalNodesToProjection(
  nodes: LexicalNode[],
  fallbackRaw: string,
  options: ConversionOptions
): LexicalProjectionNode[] {
  const filtered = options.outlineOnly ? nodes.filter((node) => node.type === 'heading') : nodes;
  if (filtered.length === 0) {
    return convertOrgToLexical(fallbackRaw, options);
  }
  return filtered.flatMap((node) => lexicalNodeToProjection(node, options));
}

export function createBlockViewModels(
  nodes: LexicalNode[],
  fallbackRaw: string,
  options: ConversionOptions
): OrgBlockViewModel[] {
  const source = options.outlineOnly ? nodes.filter((node) => node.type === 'heading') : nodes;
  if (source.length === 0) {
    return [
      {
        id: 'fallback:0',
        node: {
          type: 'paragraph',
          text: fallbackRaw,
          raw: fallbackRaw,
          line_start: 0,
          line_end: 0
        },
        projection: convertOrgToLexical(fallbackRaw, options),
        displayText: formatText(fallbackRaw, options.readerMode),
        rawText: fallbackRaw
      }
    ];
  }

  return source.map((node, idx) => ({
    id: `${node.line_start}:${node.line_end}:${node.type}:${idx}`,
    node,
    projection: lexicalNodeToProjection(node, options),
    displayText: getDisplayText(node, options),
    rawText: getRawText(node)
  }));
}

export function updateRawBlock(raw: string, node: LexicalNode, nextRawText: string): string {
  const lines = raw.split('\n');
  const safeStart = clamp(node.line_start, 0, Math.max(lines.length - 1, 0));
  const safeEnd = clamp(node.line_end, safeStart, Math.max(lines.length - 1, safeStart));
  const replacement = nextRawText.split('\n');
  lines.splice(safeStart, safeEnd - safeStart + 1, ...replacement);
  return lines.join('\n');
}

export function moveRawBlock(raw: string, node: LexicalNode, direction: -1 | 1): string {
  const blocks = splitRawIntoMovableBlocks(raw);
  const index = blocks.findIndex((block) => node.line_start >= block.start && node.line_end <= block.end);
  if (index < 0) {
    return raw;
  }
  const target = index + direction;
  if (target < 0 || target >= blocks.length) {
    return raw;
  }
  const next = blocks.slice();
  const [block] = next.splice(index, 1);
  next.splice(target, 0, block);
  return next.map((entry) => entry.raw).join('\n').replace(/\n{3,}/g, '\n\n');
}

export function measureInteraction<T>(name: string, fn: () => T): { value: T; metric: InteractionMetric } {
  const start = performanceNow();
  const value = fn();
  return { value, metric: { name, elapsedMs: performanceNow() - start } };
}

export async function measureAsyncInteraction<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ value: T; metric: InteractionMetric }> {
  const start = performanceNow();
  const value = await fn();
  return { value, metric: { name, elapsedMs: performanceNow() - start } };
}

export function convertOrgToLexical(raw: string, options: ConversionOptions): LexicalProjectionNode[] {
  if (!raw) {
    return [paragraphNode('')];
  }

  const lines = raw.split('\n');
  const nodes: LexicalProjectionNode[] = [];
  let paragraphBuffer: string[] = [];
  let inDrawer = false;
  let inCode = false;
  let codeBuffer: string[] = [];

  const pushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }
    const text = formatText(paragraphBuffer.join(' '), options.readerMode);
    nodes.push(paragraphNode(text));
    paragraphBuffer = [];
  };

  const pushCode = () => {
    if (codeBuffer.length === 0) {
      return;
    }
    nodes.push({ type: 'code_block', children: [{ text: codeBuffer.join('\n') }] } as LexicalProjectionNode);
    codeBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\+BEGIN_(SRC|EXAMPLE)/i.test(trimmed)) {
      pushParagraph();
      inCode = true;
      continue;
    }
    if (/^#\+END_(SRC|EXAMPLE)/i.test(trimmed)) {
      pushCode();
      inCode = false;
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }
    if (trimmed.match(/^:[A-Z0-9_+-]+:$/) && !trimmed.match(/^:END:$/i)) {
      inDrawer = true;
      continue;
    }
    if (trimmed.match(/^:END:$/i) && inDrawer) {
      inDrawer = false;
      continue;
    }
    if (inDrawer) {
      continue;
    }

    if (trimmed === '') {
      pushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(\*+)\s+(.*)$/);
    if (headingMatch) {
      pushParagraph();
      const depth = headingMatch[1].length;
      const text = formatText(headingMatch[2], options.readerMode);
      nodes.push({
        type: 'heading',
        depth,
        children: [{ text }]
      } as LexicalProjectionNode);
      continue;
    }

    const listMatch = line.match(/^(\s*)([-+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (listMatch && !options.outlineOnly) {
      pushParagraph();
      nodes.push({
        type: 'list_item',
        depth: Math.floor(listMatch[1].length / 2) + 1,
        ordered: /\d/.test(listMatch[2]),
        checked: listMatch[3] ? /x/i.test(listMatch[3]) : null,
        children: [{ text: formatText(listMatch[4], options.readerMode) }]
      } as LexicalProjectionNode);
      continue;
    }

    if (options.outlineOnly) {
      continue;
    }

    paragraphBuffer.push(line);
  }

  pushParagraph();
  pushCode();

  if (nodes.length === 0) {
    return [paragraphNode(formatText(raw, options.readerMode))];
  }

  return nodes;
}

function lexicalNodeToProjection(node: LexicalNode, options: ConversionOptions): LexicalProjectionNode[] {
  if (node.type === 'heading') {
    const prefix = [node.todo_keyword, node.priority ? `[#${node.priority}]` : null].filter(Boolean).join(' ');
    const tags = node.tags.length > 0 ? ` :${node.tags.join(':')}:` : '';
    const text = formatText(`${prefix ? `${prefix} ` : ''}${node.text}${tags}`, options.readerMode);
    return [{ type: 'heading', depth: node.depth, children: [{ text }] } as LexicalProjectionNode];
  }
  if (node.type === 'list_item') {
    return [
      {
        type: 'list_item',
        depth: node.depth,
        ordered: node.ordered,
        checked: node.checked ?? null,
        children: [{ text: formatText(node.text, options.readerMode) }]
      } as LexicalProjectionNode
    ];
  }
  if (node.type === 'planning') {
    return [{ type: 'planning', children: [{ text: `${node.keyword}: ${node.text}` }] } as LexicalProjectionNode];
  }
  if (node.type === 'property_drawer') {
    return [
      {
        type: 'property_drawer',
        children: [{ text: Object.entries(node.properties).map(([key, value]) => `${key}: ${value}`).join(' · ') }]
      } as LexicalProjectionNode
    ];
  }
  if (node.type === 'drawer') {
    return [{ type: 'drawer', children: [{ text: `${node.name}: ${node.text}` }] } as LexicalProjectionNode];
  }
  if (node.type === 'code_block') {
    return [{ type: 'code_block', language: node.language ?? null, children: [{ text: node.text }] } as LexicalProjectionNode];
  }
  if (node.type === 'table') {
    return [{ type: 'table', rows: node.rows, children: [{ text: node.rows.map((row) => row.join(' | ')).join('\n') }] } as LexicalProjectionNode];
  }
  if (node.type === 'directive') {
    return [{ type: 'directive', children: [{ text: `#+${node.keyword}: ${node.text}` }] } as LexicalProjectionNode];
  }
  if (node.type === 'horizontal_rule') {
    return [{ type: 'horizontal_rule', children: [{ text: '────' }] } as LexicalProjectionNode];
  }
  return [{ type: 'paragraph', children: [{ text: formatText(node.text, options.readerMode) }] } as LexicalProjectionNode];
}

function paragraphNode(text: string): LexicalProjectionNode {
  return {
    type: 'paragraph',
    children: [{ text }]
  } as LexicalProjectionNode;
}

function getRawText(node: LexicalNode): string {
  return 'raw' in node ? node.raw : getDisplayText(node, { outlineOnly: false, readerMode: false });
}

function getDisplayText(node: LexicalNode, options: ConversionOptions): string {
  if (node.type === 'heading') {
    const tags = node.tags.length > 0 ? ` :${node.tags.join(':')}:` : '';
    const todo = node.todo_keyword ? `${node.todo_keyword} ` : '';
    const priority = node.priority ? `[#${node.priority}] ` : '';
    return formatText(`${todo}${priority}${node.text}${tags}`, options.readerMode);
  }
  if (node.type === 'planning') {
    return `${node.keyword}: ${node.text}`;
  }
  if (node.type === 'property_drawer') {
    return Object.entries(node.properties).map(([key, value]) => `${key}: ${value}`).join(' · ');
  }
  if (node.type === 'drawer') {
    return `${node.name}: ${node.text}`;
  }
  if (node.type === 'table') {
    return node.rows.map((row) => row.join(' | ')).join('\n');
  }
  if (node.type === 'code_block') {
    return node.text;
  }
  if (node.type === 'directive') {
    return `#+${node.keyword}: ${node.text}`;
  }
  if (node.type === 'horizontal_rule') {
    return '────';
  }
  return formatText(node.text, options.readerMode);
}

function formatText(text: string, readerMode: boolean): string {
  if (!readerMode) {
    return text;
  }
  return text
    .replace(/\*+/g, '')
    .replace(/#\+\w+:.*$/g, '')
    .replace(/\[\[[^\]]+\]\[([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/:PROPERTIES:/g, '')
    .replace(/:END:/g, '')
    .trim();
}

interface RawBlock {
  start: number;
  end: number;
  raw: string;
}

function splitRawIntoMovableBlocks(raw: string): RawBlock[] {
  const lines = raw.split('\n');
  const blocks: RawBlock[] = [];
  let start = 0;
  for (let idx = 1; idx < lines.length; idx += 1) {
    if (/^\*+\s+/.test(lines[idx])) {
      blocks.push({ start, end: idx - 1, raw: lines.slice(start, idx).join('\n') });
      start = idx;
    }
  }
  blocks.push({ start, end: lines.length - 1, raw: lines.slice(start).join('\n') });
  return blocks.filter((block) => block.raw.trim().length > 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function performanceNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
