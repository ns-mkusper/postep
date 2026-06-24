import type { EditorState, LexicalEditor } from 'lexical';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor
} from 'lexical';

import type { LexicalNode } from '@postep/bridge';

type ProjectionMetadata = { id?: string; lineStart?: number; lineEnd?: number; sourceRaw?: string };

export type LexicalProjectionNode =
  | (ProjectionMetadata & { type: 'heading'; depth: number; children: Array<{ text: string }>; todo?: string | null; priority?: string | null; tags?: string[] })
  | (ProjectionMetadata & { type: 'list_item'; depth: number; ordered: boolean; checked: boolean | null; children: Array<{ text: string }>; marker?: string })
  | (ProjectionMetadata & { type: 'planning'; keyword?: string; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'property_drawer'; children: Array<{ text: string }>; properties?: Record<string, string> })
  | (ProjectionMetadata & { type: 'drawer'; name?: string; collapsed?: boolean; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'code_block'; language?: string | null; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'table'; rows: string[][]; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'directive'; keyword?: string; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'horizontal_rule'; children: Array<{ text: string }> })
  | (ProjectionMetadata & { type: 'paragraph'; children: Array<{ text: string }> });

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

export interface OrgLexicalDocument {
  editor: LexicalEditor;
  editorState: EditorState;
  projection: LexicalProjectionNode[];
}

export interface InteractionMetric {
  name: string;
  elapsedMs: number;
}

export const INTERACTION_BUDGET_MS = {
  blockMove: 8,
  blockEdit: 8,
  lexicalProjection: 16,
  agendaRefresh: 50
} as const;

export function createOrgLexicalDocument(
  nodes: LexicalNode[],
  fallbackRaw: string,
  options: ConversionOptions
): OrgLexicalDocument {
  const projection = lexicalNodesToProjection(nodes, fallbackRaw, options);
  const editor = createEditor({
    namespace: 'PostepOrgModeDocument',
    theme: {
      paragraph: 'org-paragraph',
      text: { bold: 'org-bold', italic: 'org-italic', code: 'org-code' }
    }
  });
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const node of projection) {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(orgProjectionPlainText(node)));
      root.append(paragraph);
    }
  }, { discrete: true });
  const editorState = editor.getEditorState();

  return { editor, editorState, projection };
}

export function orgProjectionPlainText(node: LexicalProjectionNode): string {
  const text = node.children.map((child) => child.text).join('');
  if (node.sourceRaw && !node.sourceRaw.includes('\n')) {
    return node.sourceRaw;
  }
  if (node.type === 'heading') {
    const stars = '*'.repeat(Math.max(node.depth, 1));
    const todo = node.todo ? `${node.todo} ` : '';
    const priority = node.priority ? `[#${node.priority}] ` : '';
    const tags = node.tags && node.tags.length > 0 ? ` :${node.tags.join(':')}:` : '';
    return `${stars} ${todo}${priority}${text}${tags}`;
  }
  if (node.type === 'list_item') {
    const marker = node.marker ?? (node.ordered ? '1.' : '-');
    const checkbox = node.checked === null ? '' : node.checked ? '[X] ' : '[ ] ';
    return `${'  '.repeat(Math.max(node.depth - 1, 0))}${marker} ${checkbox}${text}`;
  }
  if (node.type === 'planning') {
    return node.keyword ? `${node.keyword}: ${text}` : text;
  }
  if (node.type === 'directive') {
    return node.keyword ? `#+${node.keyword}: ${text}` : text;
  }
  if (node.type === 'property_drawer') {
    const properties = node.properties ?? {};
    const body = Object.entries(properties).map(([key, value]) => `:${key}: ${value}`).join('\n');
    return body ? `:PROPERTIES:\n${body}\n:END:` : text;
  }
  if (node.type === 'drawer') {
    return node.name ? `:${node.name}:\n${text}\n:END:` : text;
  }
  if (node.type === 'code_block') {
    return `#+BEGIN_SRC${node.language ? ` ${node.language}` : ''}\n${text}\n#+END_SRC`;
  }
  if (node.type === 'table') {
    return node.rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  }
  if (node.type === 'horizontal_rule') {
    return '-----';
  }
  return text;
}

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

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
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

    const parsedHeading = parseHeadingLine(line);
    if (parsedHeading) {
      pushParagraph();
      nodes.push({
        type: 'heading',
        depth: parsedHeading.depth,
        todo: parsedHeading.todo,
        priority: parsedHeading.priority,
        tags: parsedHeading.tags,
        sourceRaw: line,
        lineStart: lineIndex,
        lineEnd: lineIndex,
        children: [{ text: formatText(parsedHeading.title, options.readerMode) }]
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
        marker: listMatch[2],
        sourceRaw: line,
        lineStart: lineIndex,
        lineEnd: lineIndex,
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
  const metadata = { lineStart: node.line_start, lineEnd: node.line_end, sourceRaw: node.raw };
  if (node.type === 'heading') {
    const parsed = parseHeadingLine(node.raw);
    return [{
      ...metadata,
      type: 'heading',
      depth: parsed?.depth ?? node.depth,
      todo: parsed?.todo ?? node.todo_keyword ?? null,
      priority: parsed?.priority ?? node.priority ?? null,
      tags: parsed?.tags.length ? parsed.tags : node.tags,
      children: [{ text: formatText(parsed?.title ?? node.text, options.readerMode) }]
    } as LexicalProjectionNode];
  }
  if (node.type === 'list_item') {
    return [
      {
        ...metadata,
        type: 'list_item',
        depth: node.depth,
        ordered: node.ordered,
        checked: node.checked ?? null,
        sourceRaw: node.raw,
        children: [{ text: formatText(node.text, options.readerMode) }]
      } as LexicalProjectionNode
    ];
  }
  if (node.type === 'planning') {
    return [{ ...metadata, type: 'planning', keyword: node.keyword, sourceRaw: node.raw, children: [{ text: node.text }] } as LexicalProjectionNode];
  }
  if (node.type === 'property_drawer') {
    return [
      {
        ...metadata,
        type: 'property_drawer',
        properties: node.properties,
        sourceRaw: node.raw,
        children: [{ text: Object.entries(node.properties).map(([key, value]) => `${key}: ${value}`).join(' · ') }]
      } as LexicalProjectionNode
    ];
  }
  if (node.type === 'drawer') {
    return [{ ...metadata, type: 'drawer', name: node.name, collapsed: node.collapsed, sourceRaw: node.raw, children: [{ text: node.text }] } as LexicalProjectionNode];
  }
  if (node.type === 'code_block') {
    return [{ ...metadata, type: 'code_block', language: node.language ?? null, sourceRaw: node.raw, children: [{ text: node.text }] } as LexicalProjectionNode];
  }
  if (node.type === 'table') {
    return [{ ...metadata, type: 'table', rows: node.rows, sourceRaw: node.raw, children: [{ text: node.rows.map((row) => row.join(' | ')).join('\n') }] } as LexicalProjectionNode];
  }
  if (node.type === 'directive') {
    return [{ ...metadata, type: 'directive', keyword: node.keyword, sourceRaw: node.raw, children: [{ text: node.text }] } as LexicalProjectionNode];
  }
  if (node.type === 'horizontal_rule') {
    return [{ ...metadata, type: 'horizontal_rule', sourceRaw: node.raw, children: [{ text: '────' }] } as LexicalProjectionNode];
  }
  return [{ ...metadata, type: 'paragraph', sourceRaw: node.raw, children: [{ text: formatText(node.text, options.readerMode) }] } as LexicalProjectionNode];
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
    return text.trim();
  }

  return text
    .replace(/\[\[[^\]]+\]\[([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/(^|\s)([*/_=~])([^\s].*?[^\s]|[^\s])\2(?=\s|$|[.,;:!?])/g, '$1$3')
    .replace(/\\([*_`~[\]])/g, '$1')
    .trim();
}

function parseHeadingLine(line: string): { depth: number; todo: string | null; priority: string | null; title: string; tags: string[] } | null {
  const match = line.match(/^\s*(\*+)\s+(.*)$/);
  if (!match) {
    return null;
  }
  let rest = match[2].trim();
  let todo: string | null = null;
  const todoMatch = rest.match(/^(TODO|NEXT|DONE|WAITING|CANCELLED|CANCELED|SOMEDAY)\s+/);
  if (todoMatch) {
    todo = todoMatch[1];
    rest = rest.slice(todoMatch[0].length).trimStart();
  }
  let priority: string | null = null;
  const priorityMatch = rest.match(/^\[#([A-Z0-9])\]\s*/);
  if (priorityMatch) {
    priority = priorityMatch[1];
    rest = rest.slice(priorityMatch[0].length).trimStart();
  }
  let tags: string[] = [];
  const tagMatch = rest.match(/\s+(:[A-Za-z0-9_@#%:-]+:)\s*$/);
  if (tagMatch && tagMatch.index !== undefined) {
    tags = tagMatch[1].split(':').filter(Boolean);
    rest = rest.slice(0, tagMatch.index).trimEnd();
  }
  return { depth: match[1].length, todo, priority, title: rest, tags };
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
