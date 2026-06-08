import type { RoamGraph } from '@postep/bridge';

export type RoamPanel = 'graph' | 'backlinks' | 'tags';
export type RoamRelationshipFilter = 'all' | 'linked' | 'unlinked' | 'daily';

export interface RoamExplorerState {
  selectedId?: string | null;
  query?: string;
  activeTag?: string | null;
  relationshipFilter?: RoamRelationshipFilter;
}

export type RoamNode = RoamGraph['nodes'][number];
export type RoamLink = RoamGraph['links'][number];

export interface RoamNodeSummary extends RoamNode {
  incomingCount: number;
  outgoingCount: number;
  dailyDate?: string | null;
  isIsolated: boolean;
}

export interface RoamTagGroup {
  tag: string;
  count: number;
}

export interface RoamGraphSummary {
  nodes: number;
  links: number;
  tags: number;
  isolated: number;
  density: number;
}

export interface RoamRelatedNode {
  node: RoamNodeSummary;
  reasons: string[];
  score: number;
}

export interface RoamExplorerView {
  summary: RoamGraphSummary;
  nodes: RoamNodeSummary[];
  filteredNodes: RoamNodeSummary[];
  selectedNode: RoamNodeSummary | null;
  backlinks: RoamNodeSummary[];
  forwardLinks: RoamNodeSummary[];
  relatedNotes: RoamRelatedNode[];
  tagGroups: RoamTagGroup[];
  dailyNotes: RoamNodeSummary[];
  query: string;
  activeTag: string | null;
  relationshipFilter: RoamRelationshipFilter;
  emptyReason: 'no-roots' | 'no-matches' | null;
}

const DAILY_DATE_PATTERN = /(?:^|[/_-])(\d{4}-\d{2}-\d{2})(?:$|[._-])/;

export function buildRoamExplorerView(
  graph: RoamGraph,
  state: RoamExplorerState = {}
): RoamExplorerView {
  const query = normalizeSearch(state.query ?? '');
  const activeTag = state.activeTag?.trim() || null;
  const relationshipFilter = state.relationshipFilter ?? 'all';
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const link of graph.links) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) {
      continue;
    }
    outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + 1);
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
  }

  const nodes = graph.nodes
    .map((node) => summarizeNode(node, incoming.get(node.id) ?? 0, outgoing.get(node.id) ?? 0))
    .sort(compareNodes);
  const summary = summarizeGraph(nodes, graph.links);
  const tagGroups = summarizeTags(nodes);
  const dailyNotes = nodes.filter((node) => Boolean(node.dailyDate)).sort(compareDailyNotes);
  const filteredNodes = nodes.filter((node) => nodeMatches(node, query, activeTag, relationshipFilter));
  const selectedNode = selectNode(nodes, filteredNodes, state.selectedId ?? null);
  const backlinks = selectedNode ? linkedNodes(graph.links, nodes, selectedNode.id, 'incoming') : [];
  const forwardLinks = selectedNode ? linkedNodes(graph.links, nodes, selectedNode.id, 'outgoing') : [];
  const relatedNotes = selectedNode
    ? buildRelatedNotes(nodes, backlinks, forwardLinks, selectedNode).slice(0, 8)
    : [];

  return {
    summary,
    nodes,
    filteredNodes,
    selectedNode,
    backlinks,
    forwardLinks,
    relatedNotes,
    tagGroups,
    dailyNotes,
    query,
    activeTag,
    relationshipFilter,
    emptyReason: nodes.length === 0 ? 'no-roots' : filteredNodes.length === 0 ? 'no-matches' : null,
  };
}

function summarizeNode(node: RoamNode, incomingCount: number, outgoingCount: number): RoamNodeSummary {
  return {
    ...node,
    tags: [...new Set(node.tags)].sort((left, right) => left.localeCompare(right)),
    incomingCount,
    outgoingCount,
    dailyDate: inferDailyDate(node),
    isIsolated: incomingCount === 0 && outgoingCount === 0,
  };
}

function summarizeGraph(nodes: RoamNodeSummary[], links: RoamLink[]): RoamGraphSummary {
  const tags = new Set<string>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      tags.add(tag);
    }
  }
  return {
    nodes: nodes.length,
    links: links.length,
    tags: tags.size,
    isolated: nodes.filter((node) => node.isIsolated).length,
    density: nodes.length === 0 ? 0 : links.length / nodes.length,
  };
}

function summarizeTags(nodes: RoamNodeSummary[]): RoamTagGroup[] {
  const tags = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  }
  return [...tags.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
}

function selectNode(
  allNodes: RoamNodeSummary[],
  filteredNodes: RoamNodeSummary[],
  selectedId: string | null
): RoamNodeSummary | null {
  if (selectedId) {
    const selected = allNodes.find((node) => node.id === selectedId);
    if (selected) {
      return selected;
    }
  }
  return filteredNodes[0] ?? allNodes[0] ?? null;
}

function linkedNodes(
  links: RoamLink[],
  nodes: RoamNodeSummary[],
  selectedId: string,
  direction: 'incoming' | 'outgoing'
): RoamNodeSummary[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const linkedIds = links
    .filter((link) => direction === 'incoming' ? link.target === selectedId : link.source === selectedId)
    .map((link) => direction === 'incoming' ? link.source : link.target);
  return [...new Set(linkedIds)]
    .map((id) => nodeById.get(id))
    .filter((node): node is RoamNodeSummary => Boolean(node))
    .sort(compareNodes);
}

function buildRelatedNotes(
  nodes: RoamNodeSummary[],
  backlinks: RoamNodeSummary[],
  forwardLinks: RoamNodeSummary[],
  selectedNode: RoamNodeSummary
): RoamRelatedNode[] {
  const related = new Map<string, RoamRelatedNode>();
  const selectedTags = new Set(selectedNode.tags);

  const add = (node: RoamNodeSummary, reason: string, score: number) => {
    if (node.id === selectedNode.id) {
      return;
    }
    const existing = related.get(node.id);
    if (existing) {
      existing.score += score;
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      return;
    }
    related.set(node.id, { node, reasons: [reason], score });
  };

  for (const node of backlinks) {
    add(node, 'backlink', 3);
  }
  for (const node of forwardLinks) {
    add(node, 'forward link', 3);
  }
  for (const node of nodes) {
    const sharedTags = node.tags.filter((tag) => selectedTags.has(tag));
    if (sharedTags.length > 0) {
      add(node, `shared ${sharedTags.slice(0, 2).join(', ')}`, sharedTags.length);
    }
  }

  return [...related.values()].sort(
    (left, right) => right.score - left.score || compareNodes(left.node, right.node)
  );
}

function nodeMatches(
  node: RoamNodeSummary,
  query: string,
  activeTag: string | null,
  relationshipFilter: RoamRelationshipFilter
): boolean {
  if (activeTag && !node.tags.includes(activeTag)) {
    return false;
  }
  if (query) {
    const haystack = normalizeSearch(`${node.title} ${node.path} ${node.tags.join(' ')}`);
    if (!haystack.includes(query)) {
      return false;
    }
  }
  if (relationshipFilter === 'linked' && node.incomingCount + node.outgoingCount === 0) {
    return false;
  }
  if (relationshipFilter === 'unlinked' && node.incomingCount + node.outgoingCount > 0) {
    return false;
  }
  if (relationshipFilter === 'daily' && !node.dailyDate) {
    return false;
  }
  return true;
}

function inferDailyDate(node: RoamNode): string | null {
  return DAILY_DATE_PATTERN.exec(node.path)?.[1] ?? DAILY_DATE_PATTERN.exec(node.id)?.[1] ?? null;
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function compareNodes(left: RoamNodeSummary, right: RoamNodeSummary): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function compareDailyNotes(left: RoamNodeSummary, right: RoamNodeSummary): number {
  return (right.dailyDate ?? '').localeCompare(left.dailyDate ?? '') || compareNodes(left, right);
}
