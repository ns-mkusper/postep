import type { DocumentPayload, DocumentRef, LexicalNode } from "@postep/bridge";

export type NoteLine = {
  text: string;
  checked?: boolean | null;
  kind: "heading" | "list" | "body";
  lineStart?: number;
  todo?: string | null;
  priority?: string | null;
  tags?: string[];
};

export type NoteMetadata = {
  todo?: string | null;
  priority?: string | null;
  scheduled?: string | null;
  deadline?: string | null;
  habit?: boolean;
  properties: Array<{ key: string; value: string }>;
};

export type NotePreview = {
  doc: DocumentRef;
  title: string;
  lines: NoteLine[];
  checkedCount: number;
  tags: string[];
  metadata: NoteMetadata;
  primaryDate?: string | null;
};

export type MeasuredNotePreviews = {
  value: NotePreview[];
  metric: { name: string; elapsedMs: number };
};

function cleanOrgText(text: string) {
  let normalized = text.trim();
  const heading = normalized.match(/^\s*\*+\s+(.*)$/);
  if (heading) {
    normalized = heading[1]
      .replace(/\s+:([^\s]+):$/g, "")
      .replace(/^([A-Z][A-Z_-]*)\s+/, "")
      .replace(/^\[#([A-Z0-9])\]\s+/, "");
  }
  return normalized
    .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeTimestamp(text?: string | null) {
  if (!text) {
    return null;
  }
  return text
    .replace(/[<>]/g, "")
    .replace(/\s+\+\d+[dwmy]/i, "")
    .trim();
}

function isInternalParagraph(text: string) {
  return (
    /^:(LOGBOOK|END):$/i.test(text.trim()) ||
    /^State ".*" from ".*" \[/.test(text.trim())
  );
}

function textForNode(node: LexicalNode) {
  if ("text" in node) {
    return cleanOrgText(node.text);
  }
  if (node.type === "table") {
    return node.rows[0]?.join(" · ") ?? "Table";
  }
  return cleanOrgText(node.raw);
}

function listItemPreviewText(
  raw: string,
  node: Extract<LexicalNode, { type: "list_item" }>,
) {
  const lines = raw.split("\n");
  const first = lines[node.line_start] ?? "";
  const indent = first.match(/^\s*/)?.[0].length ?? 0;
  const body = [node.text];
  for (let idx = node.line_start + 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    const nextIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) {
      break;
    }
    if (
      /^\*+\s+/.test(trimmed) ||
      /^(SCHEDULED|DEADLINE|CLOSED):/.test(trimmed) ||
      /^#\+/.test(trimmed) ||
      /^:[A-Z0-9_+-]+:$/i.test(trimmed)
    ) {
      break;
    }
    if (/^([-+]|\d+[.)])\s+/.test(trimmed) && nextIndent <= indent) {
      break;
    }
    body.push(trimmed.replace(/^([-+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ""));
  }
  return cleanOrgText(body.join("\n"));
}

function titleFromDocument(doc: DocumentRef, nodes: LexicalNode[]) {
  const titleDirective = nodes.find(
    (node) =>
      node.type === "directive" && node.keyword.toUpperCase() === "TITLE",
  );
  if (
    titleDirective &&
    "text" in titleDirective &&
    titleDirective.text.trim()
  ) {
    return titleDirective.text.trim();
  }
  const heading = nodes.find((node) => node.type === "heading");
  if (heading && "text" in heading && heading.text.trim()) {
    return heading.text.trim();
  }
  return doc.name.replace(/\.org$/i, "");
}

export function buildNotePreview(doc: DocumentRef, payload: DocumentPayload): NotePreview {
  const title = titleFromDocument(doc, payload.lexical);
  const firstHeading = payload.lexical.find(
    (node): node is Extract<LexicalNode, { type: "heading" }> =>
      node.type === "heading",
  );
  const planning = payload.lexical.filter(
    (node): node is Extract<LexicalNode, { type: "planning" }> =>
      node.type === "planning",
  );
  const propertyDrawer = payload.lexical.find(
    (node): node is Extract<LexicalNode, { type: "property_drawer" }> =>
      node.type === "property_drawer",
  );
  const metadata: NoteMetadata = {
    todo: firstHeading?.todo_keyword ?? null,
    priority: firstHeading?.priority ?? null,
    scheduled: humanizeTimestamp(
      planning.find((node) => node.keyword === "SCHEDULED")?.text,
    ),
    deadline: humanizeTimestamp(
      planning.find((node) => node.keyword === "DEADLINE")?.text,
    ),
    habit: Boolean(
      firstHeading?.tags.includes("habit") ||
      propertyDrawer?.properties.STYLE?.toLowerCase() === "habit",
    ),
    properties: propertyDrawer
      ? Object.entries(propertyDrawer.properties)
          .filter(([key]) =>
            ["STYLE", "LAST_REPEAT", "EFFORT"].includes(key.toUpperCase()),
          )
          .map(([key, value]) => ({ key, value }))
      : [],
  };
  const lines: NoteLine[] = payload.lexical
    .flatMap((node): NoteLine[] => {
      if (node.type === "heading") {
        const text = textForNode(node);
        return text && text !== title
          ? [{
              text,
              kind: "heading",
              todo: node.todo_keyword ?? null,
              priority: node.priority ?? null,
              tags: node.tags,
            }]
          : [];
      }
      if (node.type === "list_item") {
        const text = listItemPreviewText(payload.raw, node);
        return text
          ? [
              {
                text,
                checked: node.checked ?? null,
                kind: "list",
                lineStart: node.line_start,
              },
            ]
          : [];
      }
      if (node.type === "paragraph") {
        const text = textForNode(node);
        return text && !isInternalParagraph(text)
          ? [{ text, kind: "body" }]
          : [];
      }
      if (node.type === "table") {
        const text = textForNode(node);
        return text ? [{ text, kind: "body" }] : [];
      }
      return [];
    })
    .slice(0, 7);
  const checkedCount = payload.lexical.filter(
    (node) => node.type === "list_item" && node.checked,
  ).length;
  const tags = Array.from(
    new Set(
      payload.lexical
        .filter(
          (node): node is Extract<LexicalNode, { type: "heading" }> =>
            node.type === "heading",
        )
        .flatMap((node) => node.tags),
    ),
  ).slice(0, 3);

  return {
    doc,
    title,
    lines,
    checkedCount,
    tags,
    metadata,
    primaryDate:
      metadata.scheduled?.slice(0, 10) ??
      metadata.deadline?.slice(0, 10) ??
      null,
  };
}

export function buildMeasuredNotePreviews(
  documents: DocumentRef[],
  payloads: DocumentPayload[],
  elapsedMs = 0,
): MeasuredNotePreviews {
  const documentsByPath = new Map(documents.map((document) => [document.path, document]));
  return {
    value: payloads
      .flatMap((payload) => {
        const doc = documentsByPath.get(payload.path);
        if (!doc || !payload.raw.trim()) {
          return [];
        }
        return [buildNotePreview(doc, payload)];
      })
      .sort((left, right) =>
        (left.primaryDate ?? "9999-12-31").localeCompare(
          right.primaryDate ?? "9999-12-31",
        ),
      ),
    metric: { name: "noteGrid", elapsedMs },
  };
}
