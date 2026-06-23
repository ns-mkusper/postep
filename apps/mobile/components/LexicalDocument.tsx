import React, { useMemo, useState } from "react";
import {
  StyleSheet,
  Text as RNText,
  TouchableOpacity,
  View,
  useColorScheme,
  type TextStyle,
} from "react-native";

import type { LexicalProjectionNode } from "../lib/orgLexicalModel";

interface LexicalDocumentProps {
  value: LexicalProjectionNode[];
  readOnly?: boolean;
  readerMode?: boolean;
  selectedKey?: string | null;
  onSelectNode?: (node: LexicalProjectionNode, index: number, key: string) => void;
}

type ThemeTokens = ReturnType<typeof documentTheme>;

type InlinePart =
  | { type: "text"; text: string }
  | { type: "link"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string };

function nodeText(node: LexicalProjectionNode): string {
  return node.children.map((child) => child.text).join("");
}

function splitTags(text: string): { body: string; tags: string[] } {
  const tagMatch = text.match(/\s+(:[A-Za-z0-9_@#%:-]+:)\s*$/);
  if (!tagMatch) {
    return { body: text, tags: [] };
  }
  return {
    body: text.slice(0, tagMatch.index).trimEnd(),
    tags: tagMatch[1].split(":").filter(Boolean),
  };
}

function splitTodo(text: string, todo?: string | null) {
  if (todo) {
    return { todo, body: text };
  }
  const match = text.match(/^(TODO|NEXT|DONE|WAITING|CANCELLED|CANCELED|SOMEDAY)\s+(.*)$/);
  if (!match) {
    return { todo: null, body: text };
  }
  return { todo: match[1], body: match[2] };
}

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\[\[[^\]]+\]\[([^\]]*)\]\]|\[\[([^\]]+)\]\]|([*_~=])([^\s].*?[^\s]|[^\s])\3/g;
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > offset) {
      parts.push({ type: "text", text: text.slice(offset, match.index) });
    }
    if (match[1] || match[2]) {
      parts.push({ type: "link", text: match[1] ?? match[2] });
    } else {
      const marker = match[3];
      parts.push({
        type: marker === "*" ? "bold" : marker === "/" ? "italic" : "code",
        text: match[4],
      });
    }
    offset = pattern.lastIndex;
  }
  if (offset < text.length) {
    parts.push({ type: "text", text: text.slice(offset) });
  }
  return parts.length > 0 ? parts : [{ type: "text", text }];
}

function documentNodeKey(node: LexicalProjectionNode, index: number): string {
  return `${node.type}:${node.lineStart ?? index}:${node.lineEnd ?? index}:${nodeText(node).slice(0, 24)}`;
}

function nodeDepth(node: LexicalProjectionNode): number {
  return "depth" in node ? Math.max(node.depth, 1) : 1;
}

function markerFor(node: LexicalProjectionNode): string | null {
  if (node.type === "heading") {
    return node.depth > 1 ? "•" : "●";
  }
  if (node.type === "list_item") {
    if (node.checked === true) {
      return "☑";
    }
    if (node.checked === false) {
      return "☐";
    }
    return node.ordered ? node.marker ?? "1." : "•";
  }
  return null;
}

function textStyleFor(node: LexicalProjectionNode, theme: ThemeTokens): TextStyle[] {
  const base = [styles.lineText, { color: theme.text }];
  if (node.type === "heading") {
    return [
      ...base,
      styles.headingText,
      { color: theme.heading },
      node.depth > 1 ? styles.subHeadingText : undefined,
    ].filter(Boolean) as TextStyle[];
  }
  if (node.type === "planning") {
    return [...base, styles.planningText, { color: theme.muted }];
  }
  if (node.type === "property_drawer" || node.type === "drawer" || node.type === "directive") {
    return [...base, styles.metadataText, { color: theme.subtle }];
  }
  if (node.type === "code_block" || node.type === "table") {
    return [...base, styles.monospaceText, { color: theme.codeText }];
  }
  if (node.type === "list_item" && node.checked) {
    return [...base, styles.doneText, { color: theme.done }];
  }
  return base;
}

function renderInline(text: string, theme: ThemeTokens, readerMode: boolean) {
  if (!readerMode) {
    return <RNText>{text}</RNText>;
  }

  return parseInline(text).map((part, index) => {
    if (part.type === "link") {
      return (
        <RNText key={`${part.type}-${index}`} style={{ color: theme.link, textDecorationLine: "underline" }}>
          {part.text}
        </RNText>
      );
    }
    if (part.type === "bold") {
      return <RNText key={`${part.type}-${index}`} style={{ fontWeight: "800" }}>{part.text}</RNText>;
    }
    if (part.type === "italic") {
      return <RNText key={`${part.type}-${index}`} style={{ fontStyle: "italic" }}>{part.text}</RNText>;
    }
    if (part.type === "code") {
      return (
        <RNText key={`${part.type}-${index}`} style={[styles.inlineCode, { color: theme.codeText, backgroundColor: theme.codeBg }]}>
          {part.text}
        </RNText>
      );
    }
    return <RNText key={`${part.type}-${index}`}>{part.text}</RNText>;
  });
}

function renderRichText(node: LexicalProjectionNode, theme: ThemeTokens, readerMode: boolean) {
  if (node.type === "heading") {
    const text = nodeText(node);
    const { body, tags } = splitTags(text);
    const todoParts = splitTodo(body, node.todo);
    const allTags = node.tags && node.tags.length > 0 ? node.tags : tags;
    const done = todoParts.todo === "DONE";
    return (
      <RNText style={textStyleFor(node, theme)} testID={`document-heading-${node.lineStart ?? 0}`}>
        {todoParts.todo ? (
          <RNText style={[styles.todoKeyword, { color: done ? theme.done : theme.todo }]}>
            {todoParts.todo}{" "}
          </RNText>
        ) : null}
        {node.priority ? (
          <RNText style={[styles.priorityText, { color: theme.priority }]}>#{node.priority} </RNText>
        ) : null}
        {renderInline(todoParts.body, theme, readerMode)}
        {allTags.length > 0 ? (
          <RNText style={[styles.tagsText, { color: theme.tag }]}> {allTags.map((tag) => `#${tag}`).join(" ")}</RNText>
        ) : null}
      </RNText>
    );
  }

  if (node.type === "planning") {
    return (
      <RNText style={textStyleFor(node, theme)}>
        <RNText style={[styles.planningKeyword, { color: theme.keyword }]}>{node.keyword}</RNText>
        {node.keyword ? ": " : ""}
        {nodeText(node).replace(/[<>]/g, "")}
      </RNText>
    );
  }

  if (node.type === "directive") {
    return (
      <RNText style={textStyleFor(node, theme)}>
        {node.keyword ? `${node.keyword}: ` : ""}{renderInline(nodeText(node), theme, readerMode)}
      </RNText>
    );
  }

  return <RNText style={textStyleFor(node, theme)}>{renderInline(nodeText(node), theme, readerMode)}</RNText>;
}

export function LexicalDocument({ value, readerMode = true, selectedKey, onSelectNode }: LexicalDocumentProps) {
  const scheme = useColorScheme();
  const theme = documentTheme(scheme === "dark");
  const [foldedKeys, setFoldedKeys] = useState<Set<string>>(() => new Set());

  const expandableKeys = useMemo(() => {
    const keys = new Set<string>();
    value.forEach((node, index) => {
      const isStructural = node.type === "heading" || node.type === "list_item";
      if (!isStructural) {
        return;
      }
      const depth = nodeDepth(node);
      const next = value[index + 1];
      if (!next) {
        return;
      }
      const nextStartsPeerHeading =
        node.type === "heading" &&
        next.type === "heading" &&
        nodeDepth(next) <= depth;
      const nextIsNestedListItem =
        node.type === "list_item" && nodeDepth(next) > depth;
      if ((node.type === "heading" && !nextStartsPeerHeading) || nextIsNestedListItem) {
        keys.add(documentNodeKey(node, index));
      }
    });
    return keys;
  }, [value]);

  const visibleRows = useMemo(() => {
    const rows: Array<{ element: LexicalProjectionNode; index: number; key: string }> = [];
    const foldedAncestors: Array<{ depth: number; type: "heading" | "list_item" }> = [];

    value.forEach((element, index) => {
      const depth = nodeDepth(element);
      while (foldedAncestors.length > 0) {
        const ancestor = foldedAncestors[foldedAncestors.length - 1];
        const reachedHeadingBoundary =
          ancestor.type === "heading" && element.type === "heading" && depth <= ancestor.depth;
        const reachedListBoundary = ancestor.type === "list_item" && depth <= ancestor.depth;
        if (!reachedHeadingBoundary && !reachedListBoundary) {
          break;
        }
        foldedAncestors.pop();
      }
      if (foldedAncestors.length > 0) {
        return;
      }

      const key = documentNodeKey(element, index);
      rows.push({ element, index, key });
      if ((element.type === "heading" || element.type === "list_item") && foldedKeys.has(key)) {
        foldedAncestors.push({ depth, type: element.type });
      }
    });

    return rows;
  }, [foldedKeys, value]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="lexical-org-document">
      {visibleRows.map(({ element, index, key }) => {
        const marker = markerFor(element);
        const depth = nodeDepth(element);
        const isStructural = element.type === "heading" || element.type === "list_item";
        const isCodeLike = element.type === "code_block" || element.type === "table";
        const canFold = isStructural && expandableKeys.has(key);
        const isFolded = foldedKeys.has(key);
        const selected = selectedKey === key;

        if (element.type === "horizontal_rule") {
          return <View key={key} style={[styles.rule, { backgroundColor: theme.rule }]} />;
        }

        return (
          <TouchableOpacity
            key={key}
            activeOpacity={0.78}
            onPress={() => onSelectNode?.(element, index, key)}
            testID={`document-node-${index}`}
            accessibilityRole="button"
            accessibilityLabel="Select document item"
            style={[
              styles.lineRow,
              { paddingLeft: Math.min((depth - 1) * 26, 104) },
              isCodeLike && [styles.codeRow, { backgroundColor: theme.codeBg }],
              selected && { backgroundColor: theme.selected, borderColor: theme.selectedBorder },
            ]}
          >
            {depth > 1 && <View style={[styles.indentGuide, { backgroundColor: theme.indent }]} />}
            <View style={styles.markerColumn}>
              {marker ? (
                <RNText style={[styles.marker, { color: theme.marker }, element.type === "heading" && styles.headingMarker]}>
                  {marker}
                </RNText>
              ) : null}
            </View>
            <View style={styles.textColumn}>
              {renderRichText(element, theme, readerMode)}
              {canFold ? (
                <TouchableOpacity
                  style={[styles.foldButton, { borderColor: theme.foldBorder, backgroundColor: theme.foldBg }]}
                  accessibilityRole="button"
                  accessibilityLabel={isFolded ? "Expand item" : "Collapse item"}
                  testID={`document-fold-${index}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    setFoldedKeys((current) => {
                      const next = new Set(current);
                      if (next.has(key)) {
                        next.delete(key);
                      } else {
                        next.add(key);
                      }
                      return next;
                    });
                  }}
                >
                  <RNText style={[styles.foldIndicator, { color: theme.text }]}>{isFolded ? "+" : "−"}</RNText>
                </TouchableOpacity>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function documentTheme(dark: boolean) {
  return dark
    ? {
        background: "#101218",
        text: "#ECEFF7",
        heading: "#FFFFFF",
        marker: "#D8E2FF",
        muted: "#B4BDD1",
        subtle: "#8F98AA",
        todo: "#FF8A8A",
        done: "#95D59F",
        priority: "#FFBC70",
        tag: "#9DB2FF",
        keyword: "#C7D2FE",
        link: "#8AB4FF",
        codeBg: "#1C2230",
        codeText: "#DBEAFE",
        indent: "#343B4B",
        rule: "#3D4658",
        selected: "#1C2A44",
        selectedBorder: "#6E8BE8",
        foldBg: "#182033",
        foldBorder: "#3F4A62",
      }
    : {
        background: "#FAF9FD",
        text: "#2E3038",
        heading: "#252832",
        marker: "#111827",
        muted: "#6B7280",
        subtle: "#8A8D98",
        todo: "#C01818",
        done: "#72A879",
        priority: "#B15E10",
        tag: "#646771",
        keyword: "#4B5563",
        link: "#315BD8",
        codeBg: "#F1F1F7",
        codeText: "#293041",
        indent: "#DDDCE7",
        rule: "#D5D5E2",
        selected: "#EEF2FF",
        selectedBorder: "#8398E8",
        foldBg: "#FFFFFF",
        foldBorder: "#DADBE8",
      };
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  lineRow: {
    minHeight: 31,
    flexDirection: "row",
    alignItems: "flex-start",
    position: "relative",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 12,
    paddingVertical: 2,
  },
  indentGuide: {
    position: "absolute",
    left: 12,
    top: 0,
    bottom: -2,
    width: 1,
  },
  markerColumn: {
    width: 28,
    minHeight: 31,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  marker: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "900",
  },
  headingMarker: {
    fontSize: 19,
  },
  textColumn: {
    flex: 1,
    minHeight: 31,
    paddingRight: 28,
  },
  lineText: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "400",
  },
  headingText: {
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "600",
  },
  subHeadingText: {
    fontSize: 20,
    lineHeight: 27,
  },
  todoKeyword: {
    fontWeight: "900",
  },
  priorityText: {
    fontWeight: "800",
  },
  tagsText: {
    fontSize: 17,
  },
  planningText: {
    fontSize: 17,
    lineHeight: 23,
  },
  planningKeyword: {
    fontWeight: "800",
  },
  metadataText: {
    fontSize: 16,
    lineHeight: 22,
  },
  monospaceText: {
    fontFamily: "monospace",
    fontSize: 16,
    lineHeight: 22,
  },
  inlineCode: {
    fontFamily: "monospace",
    borderRadius: 4,
    paddingHorizontal: 3,
  },
  doneText: {
    textDecorationLine: "line-through",
  },
  codeRow: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 4,
  },
  foldButton: {
    position: "absolute",
    top: 2,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  foldIndicator: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "800",
  },
  rule: {
    height: 1,
    marginVertical: 14,
  },
});
