export type HeadingPlacement = "above" | "under" | "below";
export type MoveKind = "up" | "down" | "promote" | "demote";

export interface HeadingRange {
  start: number;
  end: number;
  depth: number;
  line: string;
}

const TODO_KEYWORDS = ["TODO", "NEXT", "DONE", "WAITING", "CANCELLED", "CANCELED", "SOMEDAY"];
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatOrgDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  return `<${year}-${month}-${day} ${weekday}>`;
}

export function firstHeadingLine(raw: string): number {
  const lines = raw.split("\n");
  const index = lines.findIndex((line) => /^\*+\s+/.test(line));
  return index >= 0 ? index : 0;
}

export function findHeadingRange(raw: string, lineStart?: number | null): HeadingRange | null {
  const lines = raw.split("\n");
  if (lines.length === 0) {
    return null;
  }
  const preferred = Math.min(Math.max(lineStart ?? firstHeadingLine(raw), 0), lines.length - 1);
  let start = preferred;
  while (start > 0 && !/^\*+\s+/.test(lines[start])) {
    start -= 1;
  }
  if (!/^\*+\s+/.test(lines[start])) {
    start = lines.findIndex((line) => /^\*+\s+/.test(line));
  }
  if (start < 0) {
    return null;
  }
  const depth = lines[start].match(/^(\*+)/)?.[1].length ?? 1;
  let end = lines.length - 1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\*+)\s+/);
    if (match && match[1].length <= depth) {
      end = index - 1;
      break;
    }
  }
  return { start, end, depth, line: lines[start] };
}

export function copyHeadingBlock(raw: string, lineStart?: number | null): string {
  const range = findHeadingRange(raw, lineStart);
  if (!range) {
    return raw;
  }
  return raw.split("\n").slice(range.start, range.end + 1).join("\n");
}

export function cutHeadingBlock(raw: string, lineStart?: number | null): { raw: string; block: string } {
  const range = findHeadingRange(raw, lineStart);
  if (!range) {
    return { raw, block: raw };
  }
  const lines = raw.split("\n");
  const block = lines.slice(range.start, range.end + 1).join("\n");
  lines.splice(range.start, range.end - range.start + 1);
  return { raw: lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), block };
}

export function pasteHeadingBlock(
  raw: string,
  block: string,
  lineStart: number | null | undefined,
  placement: HeadingPlacement,
): string {
  if (!block.trim()) {
    return raw;
  }
  const lines = raw ? raw.split("\n") : [];
  const range = findHeadingRange(raw, lineStart);
  let insertAt = lines.length;
  let targetDepth = 1;
  if (range) {
    targetDepth = placement === "under" ? range.depth + 1 : range.depth;
    insertAt = placement === "above" ? range.start : placement === "under" ? range.start + 1 : range.end + 1;
  }
  const normalized = normalizeBlockDepth(block, targetDepth).split("\n");
  lines.splice(insertAt, 0, ...normalized);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function insertHeading(
  raw: string,
  title: string,
  lineStart: number | null | undefined,
  placement: HeadingPlacement,
): string {
  const cleanTitle = title.trim() || "New item";
  const range = findHeadingRange(raw, lineStart);
  const lines = raw ? raw.split("\n") : [];
  let insertAt = lines.length;
  let depth = 1;
  if (range) {
    depth = placement === "under" ? range.depth + 1 : range.depth;
    insertAt = placement === "above" ? range.start : placement === "under" ? range.start + 1 : range.end + 1;
  }
  lines.splice(insertAt, 0, `${"*".repeat(depth)} ${cleanTitle}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function setHeadingState(raw: string, lineStart: number | null | undefined, state: string | null): string {
  return updateHeadingLine(raw, lineStart, (parts) => ({ ...parts, todo: state }));
}

export function toggleHeadingState(raw: string, lineStart?: number | null): string {
  const parts = parseHeadingLine(findHeadingRange(raw, lineStart)?.line ?? "");
  const next = parts?.todo === "DONE" ? "TODO" : "DONE";
  return setHeadingState(raw, lineStart, next);
}

export function setHeadingPriority(raw: string, lineStart: number | null | undefined, priority: string | null): string {
  return updateHeadingLine(raw, lineStart, (parts) => ({ ...parts, priority }));
}

export function setHeadingTags(raw: string, lineStart: number | null | undefined, tags: string[]): string {
  return updateHeadingLine(raw, lineStart, (parts) => ({ ...parts, tags }));
}

export function archiveHeading(raw: string, lineStart?: number | null): string {
  const parts = parseHeadingLine(findHeadingRange(raw, lineStart)?.line ?? "");
  const tags = new Set(parts?.tags ?? []);
  tags.add("ARCHIVE");
  return setHeadingTags(raw, lineStart, Array.from(tags));
}

export function setPlanningTimestamp(
  raw: string,
  lineStart: number | null | undefined,
  keyword: "SCHEDULED" | "DEADLINE",
  timestamp: string | null,
): string {
  const range = findHeadingRange(raw, lineStart);
  if (!range) {
    return raw;
  }
  const lines = raw.split("\n");
  const planningPattern = new RegExp(`^\\s*${keyword}:`, "i");
  const existing = lines.findIndex((line, index) => index > range.start && index <= range.end && planningPattern.test(line));
  if (!timestamp) {
    if (existing >= 0) {
      lines.splice(existing, 1);
      return lines.join("\n").trimEnd();
    }
    return raw;
  }
  const nextLine = `${keyword}: ${timestamp}`;
  if (existing >= 0) {
    lines[existing] = nextLine;
  } else {
    lines.splice(range.start + 1, 0, nextLine);
  }
  return lines.join("\n").trimEnd();
}

export function moveHeading(raw: string, lineStart: number | null | undefined, move: MoveKind): string {
  const range = findHeadingRange(raw, lineStart);
  if (!range) {
    return raw;
  }
  if (move === "promote" || move === "demote") {
    return changeHeadingDepth(raw, range, move === "promote" ? -1 : 1);
  }
  return moveHeadingVertically(raw, range, move === "up" ? -1 : 1);
}

export function refileHeadingUnder(raw: string, sourceLineStart: number | null | undefined, targetLineStart: number): string {
  const source = findHeadingRange(raw, sourceLineStart);
  const target = findHeadingRange(raw, targetLineStart);
  if (!source || !target || (target.start >= source.start && target.start <= source.end)) {
    return raw;
  }
  const { raw: withoutSource, block } = cutHeadingBlock(raw, source.start);
  const adjustedTarget = target.start > source.start ? Math.max(target.start - (source.end - source.start + 1), 0) : target.start;
  return pasteHeadingBlock(withoutSource, block, adjustedTarget, "under");
}

export function headingChoices(raw: string): Array<{ lineStart: number; title: string; depth: number }> {
  return raw.split("\n").flatMap((line, lineStart) => {
    const parts = parseHeadingLine(line);
    if (!parts) {
      return [];
    }
    return [{ lineStart, title: parts.title || "Untitled", depth: parts.depth }];
  });
}

function updateHeadingLine(
  raw: string,
  lineStart: number | null | undefined,
  update: (parts: ParsedHeading) => ParsedHeading,
): string {
  const range = findHeadingRange(raw, lineStart);
  if (!range) {
    return raw;
  }
  const lines = raw.split("\n");
  const parts = parseHeadingLine(lines[range.start]);
  if (!parts) {
    return raw;
  }
  lines[range.start] = serializeHeadingLine(update(parts));
  return lines.join("\n").trimEnd();
}

interface ParsedHeading {
  depth: number;
  todo: string | null;
  priority: string | null;
  title: string;
  tags: string[];
}

function parseHeadingLine(line: string): ParsedHeading | null {
  const match = line.match(/^(\*+)\s+(.*)$/);
  if (!match) {
    return null;
  }
  let rest = match[2].trim();
  let todo: string | null = null;
  const firstWord = rest.match(/^([A-Z][A-Z0-9_-]*)\s+/);
  if (firstWord && TODO_KEYWORDS.includes(firstWord[1])) {
    todo = firstWord[1];
    rest = rest.slice(firstWord[0].length).trimStart();
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
    tags = tagMatch[1].split(":").filter(Boolean);
    rest = rest.slice(0, tagMatch.index).trimEnd();
  }
  return { depth: match[1].length, todo, priority, title: rest, tags };
}

function serializeHeadingLine(parts: ParsedHeading): string {
  const todo = parts.todo ? `${parts.todo} ` : "";
  const priority = parts.priority ? `[#${parts.priority}] ` : "";
  const tags = parts.tags.length > 0 ? ` :${parts.tags.join(":")}:` : "";
  return `${"*".repeat(Math.max(parts.depth, 1))} ${todo}${priority}${parts.title}${tags}`.trimEnd();
}

function normalizeBlockDepth(block: string, targetDepth: number): string {
  const lines = block.split("\n");
  const firstHeading = lines.find((line) => /^\*+\s+/.test(line));
  const sourceDepth = firstHeading?.match(/^(\*+)/)?.[1].length ?? targetDepth;
  const delta = Math.max(targetDepth, 1) - sourceDepth;
  return lines
    .map((line) => {
      const match = line.match(/^(\*+)(\s+.*)$/);
      if (!match) {
        return line;
      }
      const nextDepth = Math.max(match[1].length + delta, 1);
      return `${"*".repeat(nextDepth)}${match[2]}`;
    })
    .join("\n");
}

function changeHeadingDepth(raw: string, range: HeadingRange, delta: -1 | 1): string {
  const lines = raw.split("\n");
  for (let index = range.start; index <= range.end; index += 1) {
    const match = lines[index]?.match(/^(\*+)(\s+.*)$/);
    if (match) {
      const nextDepth = Math.max(match[1].length + delta, 1);
      lines[index] = `${"*".repeat(nextDepth)}${match[2]}`;
    }
  }
  return lines.join("\n").trimEnd();
}

function moveHeadingVertically(raw: string, range: HeadingRange, direction: -1 | 1): string {
  const lines = raw.split("\n");
  const siblings = siblingRanges(raw, range.depth).filter((sibling) => sibling.depth === range.depth);
  const index = siblings.findIndex((sibling) => sibling.start === range.start);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
    return raw;
  }
  const source = siblings[index];
  const target = siblings[targetIndex];
  const sourceLines = lines.slice(source.start, source.end + 1);
  lines.splice(source.start, source.end - source.start + 1);
  const insertAt = direction < 0 ? target.start : target.end - (source.end - source.start + 1) + 1;
  lines.splice(insertAt, 0, ...sourceLines);
  return lines.join("\n").trimEnd();
}

function siblingRanges(raw: string, depth: number): HeadingRange[] {
  const lines = raw.split("\n");
  const ranges: HeadingRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\*+)\s+/);
    if (!match || match[1].length !== depth) {
      continue;
    }
    const range = findHeadingRange(raw, index);
    if (range) {
      ranges.push(range);
    }
  }
  return ranges;
}

export function timestampShortcut(shortcut: "today" | "tomorrow", now = new Date()): string {
  return formatOrgDate(new Date(now.getTime() + (shortcut === "tomorrow" ? DAY_MS : 0)));
}
