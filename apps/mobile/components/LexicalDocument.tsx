import React, { useMemo } from "react";
import { createEditor } from "lexical";
import { StyleSheet, Text as RNText, View } from "react-native";

import type { LexicalProjectionNode } from "../lib/orgLexicalModel";

interface LexicalDocumentProps {
  value: LexicalProjectionNode[];
  readOnly?: boolean;
}

function nodeText(node: LexicalProjectionNode): string {
  return node.children.map((child) => child.text).join("");
}

export function LexicalDocument({ value }: LexicalDocumentProps) {
  useMemo(() => createEditor({ namespace: "postep-org-document" }), []);

  return (
    <View style={styles.container}>
      {value.map((element, index) => {
        const children = nodeText(element);
        const key = `${element.type}:${index}:${children.slice(0, 24)}`;
        if (element.type === "heading") {
          const fontSize = Math.max(30 - (element.depth - 1) * 3, 21);
          return (
            <View key={key} style={styles.headingBlock}>
              <RNText
                style={[
                  styles.headingText,
                  { fontSize, lineHeight: fontSize + 7 },
                ]}
              >
                {children}
              </RNText>
            </View>
          );
        }
        if (element.type === "list_item") {
          const ordered = element.checked === null && element.ordered;
          return (
            <View
              key={key}
              style={[
                styles.listItem,
                { paddingLeft: Math.max((element.depth - 1) * 16, 0) },
              ]}
            >
              {element.checked === null ? (
                <RNText style={styles.bullet}>{ordered ? "1." : "•"}</RNText>
              ) : (
                <View
                  style={[
                    styles.checkbox,
                    element.checked && styles.checkboxChecked,
                  ]}
                />
              )}
              <RNText
                style={[styles.bodyText, element.checked && styles.checkedText]}
              >
                {children}
              </RNText>
            </View>
          );
        }
        if (element.type === "planning") {
          return (
            <View key={key} style={styles.metadataCard}>
              <RNText style={styles.metadataText}>{children}</RNText>
            </View>
          );
        }
        if (element.type === "property_drawer" || element.type === "drawer") {
          return (
            <View key={key} style={styles.drawerCard}>
              <RNText style={styles.drawerText}>{children}</RNText>
            </View>
          );
        }
        if (element.type === "code_block") {
          return (
            <View key={key} style={styles.codeCard}>
              <RNText style={styles.codeText}>{children}</RNText>
            </View>
          );
        }
        if (element.type === "table") {
          return (
            <View key={key} style={styles.tableCard}>
              <RNText style={styles.tableText}>{children}</RNText>
            </View>
          );
        }
        if (element.type === "directive") {
          return (
            <View key={key} style={styles.directiveBlock}>
              <RNText style={styles.directiveText}>{children}</RNText>
            </View>
          );
        }
        if (element.type === "horizontal_rule") {
          return <View key={key} style={styles.rule} />;
        }
        return (
          <View key={key} style={styles.paragraphBlock}>
            <RNText style={styles.bodyText}>{children}</RNText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 4, gap: 8 },
  headingBlock: { paddingVertical: 3 },
  headingText: { fontWeight: "800", color: "#F2F5EC" },
  paragraphBlock: { paddingVertical: 2 },
  bodyText: { flex: 1, fontSize: 20, lineHeight: 28, color: "#E4EADF" },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 3,
  },
  bullet: {
    width: 22,
    color: "#B7BFB0",
    fontSize: 20,
    lineHeight: 28,
    textAlign: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 3,
    borderWidth: 2.2,
    borderColor: "#929A8C",
    marginTop: 4,
  },
  checkboxChecked: { backgroundColor: "#8E987E", borderColor: "#8E987E" },
  checkedText: { color: "#858C7F", textDecorationLine: "line-through" },
  metadataCard: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    backgroundColor: "#111A10",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#303B2D",
  },
  metadataText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#C9D4BD",
    fontWeight: "700",
  },
  drawerCard: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    backgroundColor: "#0C150B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#263323",
  },
  drawerText: { fontSize: 13, lineHeight: 19, color: "#8F9888" },
  codeCard: {
    padding: 12,
    backgroundColor: "#050905",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#263323",
  },
  codeText: {
    fontSize: 14,
    color: "#BDE7B6",
    lineHeight: 21,
    fontFamily: "monospace",
  },
  tableCard: {
    padding: 11,
    backgroundColor: "#0C150B",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#263323",
  },
  tableText: {
    fontSize: 14,
    color: "#DDE5D4",
    lineHeight: 21,
    fontFamily: "monospace",
  },
  directiveBlock: { paddingVertical: 2 },
  directiveText: { fontSize: 13, color: "#8F9888" },
  rule: { height: 1, backgroundColor: "#3D4638", marginVertical: 10 },
});
