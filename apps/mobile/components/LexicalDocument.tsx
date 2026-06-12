import React, { useMemo, useState } from "react";
import { StyleSheet, Text as RNText, TouchableOpacity, View } from "react-native";

import type { LexicalProjectionNode } from "../lib/orgLexicalModel";

interface LexicalDocumentProps {
  value: LexicalProjectionNode[];
  readOnly?: boolean;
}

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

function documentNodeKey(node: LexicalProjectionNode, index: number): string {
  return `${node.type}:${index}:${nodeText(node).slice(0, 24)}`;
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
    return node.ordered ? "1." : "•";
  }
  return null;
}

function textStyleFor(node: LexicalProjectionNode) {
  if (node.type === "heading") {
    return [styles.lineText, styles.headingText, node.depth > 1 && styles.subHeadingText];
  }
  if (node.type === "planning") {
    return [styles.lineText, styles.planningText];
  }
  if (node.type === "property_drawer" || node.type === "drawer" || node.type === "directive") {
    return [styles.lineText, styles.metadataText];
  }
  if (node.type === "code_block" || node.type === "table") {
    return [styles.lineText, styles.monospaceText];
  }
  if (node.type === "list_item" && node.checked) {
    return [styles.lineText, styles.doneText];
  }
  return [styles.lineText];
}

function renderRichText(node: LexicalProjectionNode) {
  if (node.type === "heading") {
    const text = nodeText(node);
    const { body, tags } = splitTags(text);
    const todoParts = splitTodo(body, node.todo);
    const allTags = node.tags && node.tags.length > 0 ? node.tags : tags;
    const done = todoParts.todo === "DONE";
    return (
      <RNText style={textStyleFor(node)}>
        {todoParts.todo ? (
          <RNText style={[styles.todoKeyword, done && styles.doneKeyword]}>
            {todoParts.todo}{" "}
          </RNText>
        ) : null}
        {node.priority ? (
          <RNText style={styles.priorityText}>[#{node.priority}] </RNText>
        ) : null}
        <RNText>{todoParts.body}</RNText>
        {allTags.length > 0 ? (
          <RNText style={styles.tagsText}> {allTags.join(" ")}</RNText>
        ) : null}
      </RNText>
    );
  }

  if (node.type === "planning") {
    return (
      <RNText style={textStyleFor(node)}>
        <RNText style={styles.planningKeyword}>{node.keyword}</RNText>
        {node.keyword ? ": " : ""}
        {nodeText(node)}
      </RNText>
    );
  }

  return <RNText style={textStyleFor(node)}>{nodeText(node)}</RNText>;
}

export function LexicalDocument({ value }: LexicalDocumentProps) {
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
      if (next && nodeDepth(next) > depth) {
        keys.add(documentNodeKey(node, index));
      }
    });
    return keys;
  }, [value]);

  const visibleRows = useMemo(() => {
    const rows: Array<{ element: LexicalProjectionNode; index: number; key: string }> = [];
    const foldedAncestors: Array<{ depth: number; key: string }> = [];

    value.forEach((element, index) => {
      const depth = nodeDepth(element);
      while (foldedAncestors.length > 0 && foldedAncestors[foldedAncestors.length - 1].depth >= depth) {
        foldedAncestors.pop();
      }
      if (foldedAncestors.length > 0) {
        return;
      }

      const key = documentNodeKey(element, index);
      rows.push({ element, index, key });
      if (foldedKeys.has(key)) {
        foldedAncestors.push({ depth, key });
      }
    });

    return rows;
  }, [foldedKeys, value]);

  return (
    <View style={styles.container} testID="lexical-org-document">
      {visibleRows.map(({ element, index, key }) => {
        const marker = markerFor(element);
        const depth = nodeDepth(element);
        const isStructural = element.type === "heading" || element.type === "list_item";
        const isCodeLike = element.type === "code_block" || element.type === "table";
        const canFold = isStructural && expandableKeys.has(key);
        const isFolded = foldedKeys.has(key);

        if (element.type === "horizontal_rule") {
          return <View key={key} style={styles.rule} />;
        }

        return (
          <View
            key={key}
            style={[
              styles.lineRow,
              { paddingLeft: Math.min((depth - 1) * 26, 104) },
              isCodeLike && styles.codeRow,
            ]}
          >
            {depth > 1 && <View style={styles.indentGuide} />}
            <View style={styles.markerColumn}>
              {marker ? (
                <RNText style={[styles.marker, element.type === "heading" && styles.headingMarker]}>
                  {marker}
                </RNText>
              ) : null}
            </View>
            <View style={styles.textColumn}>
              {renderRichText(element)}
              {canFold ? (
                <TouchableOpacity
                  style={styles.foldButton}
                  accessibilityRole="button"
                  accessibilityLabel={isFolded ? "Expand item" : "Collapse item"}
                  testID={`document-fold-${index}`}
                  onPress={() => {
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
                  <RNText style={styles.foldIndicator}>{isFolded ? "+" : "−"}</RNText>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: "#FAF9FD",
  },
  lineRow: {
    minHeight: 31,
    flexDirection: "row",
    alignItems: "flex-start",
    position: "relative",
  },
  indentGuide: {
    position: "absolute",
    left: 12,
    top: 0,
    bottom: -2,
    width: 1,
    backgroundColor: "#DDDCE7",
  },
  markerColumn: {
    width: 28,
    minHeight: 31,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  marker: {
    color: "#111827",
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
    color: "#2E3038",
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "400",
  },
  headingText: {
    color: "#252832",
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "500",
  },
  subHeadingText: {
    fontSize: 20,
    lineHeight: 27,
  },
  todoKeyword: {
    color: "#C01818",
    fontWeight: "900",
  },
  doneKeyword: {
    color: "#72A879",
  },
  priorityText: {
    color: "#B15E10",
    fontWeight: "800",
  },
  tagsText: {
    color: "#646771",
    fontSize: 17,
  },
  planningText: {
    color: "#6B7280",
    fontSize: 17,
    lineHeight: 23,
  },
  planningKeyword: {
    fontWeight: "800",
    color: "#4B5563",
  },
  metadataText: {
    color: "#8A8D98",
    fontSize: 16,
    lineHeight: 22,
  },
  monospaceText: {
    color: "#30343F",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "monospace",
  },
  codeRow: {
    backgroundColor: "#F1F1F7",
    borderRadius: 4,
    marginVertical: 2,
    paddingVertical: 5,
  },
  doneText: {
    color: "#A8ABB4",
  },
  foldButton: {
    position: "absolute",
    right: 0,
    top: 1,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  foldIndicator: {
    color: "#4B5563",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "700",
  },
  rule: {
    height: 1,
    marginVertical: 9,
    backgroundColor: "#D6D6E0",
  },
});
