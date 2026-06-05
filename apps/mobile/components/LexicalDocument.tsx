import React, { useMemo } from 'react';
import { createEditor } from 'lexical';
import { Text as RNText, View } from 'react-native';

import type { LexicalProjectionNode } from '../lib/orgLexicalModel';

interface LexicalDocumentProps {
  value: LexicalProjectionNode[];
  readOnly?: boolean;
}

function nodeText(node: LexicalProjectionNode): string {
  return node.children.map((child) => child.text).join('');
}

export function LexicalDocument({ value }: LexicalDocumentProps) {
  useMemo(() => createEditor({ namespace: 'postep-org-document' }), []);

  return (
    <View style={{ padding: 6 }}>
      {value.map((element, index) => {
        const children = nodeText(element);
        const key = `${element.type}:${index}:${children.slice(0, 24)}`;
        if (element.type === 'heading') {
          const fontSize = Math.max(22 - (element.depth - 1) * 2, 16);
          return (
            <View key={key} style={{ paddingVertical: 4 }}>
              <RNText style={{ fontSize, fontWeight: '700', color: '#F5F6FA' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'list_item') {
          const bullet = element.checked === true ? '☑' : element.checked === false ? '☐' : element.ordered ? '1.' : '•';
          return (
            <View key={key} style={{ paddingVertical: 2, paddingLeft: Math.max((element.depth - 1) * 16, 0) + 16 }}>
              <RNText style={{ fontSize: 16, color: '#E3E6EF', lineHeight: 22 }}>{`${bullet} ${children}`}</RNText>
            </View>
          );
        }
        if (element.type === 'planning') {
          return (
            <View key={key} style={{ paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#21293B', borderRadius: 10 }}>
              <RNText style={{ fontSize: 13, color: '#BFD0FF', fontWeight: '600' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'property_drawer' || element.type === 'drawer') {
          return (
            <View key={key} style={{ paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#151922', borderRadius: 10 }}>
              <RNText style={{ fontSize: 12, color: '#8E98B3' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'code_block') {
          return (
            <View key={key} style={{ padding: 12, backgroundColor: '#05070B', borderRadius: 10 }}>
              <RNText style={{ fontSize: 13, color: '#A7F3D0', lineHeight: 20, fontFamily: 'monospace' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'table') {
          return (
            <View key={key} style={{ padding: 10, backgroundColor: '#111722', borderRadius: 10 }}>
              <RNText style={{ fontSize: 13, color: '#DCE4F9', lineHeight: 20, fontFamily: 'monospace' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'directive') {
          return (
            <View key={key} style={{ paddingVertical: 2 }}>
              <RNText style={{ fontSize: 12, color: '#7C879F' }}>{children}</RNText>
            </View>
          );
        }
        if (element.type === 'horizontal_rule') {
          return (
            <View key={key} style={{ paddingVertical: 8 }}>
              <RNText style={{ color: '#3B4254' }}>{children}</RNText>
            </View>
          );
        }
        return (
          <View key={key} style={{ paddingVertical: 2 }}>
            <RNText style={{ fontSize: 16, color: '#E3E6EF', lineHeight: 22 }}>{children}</RNText>
          </View>
        );
      })}
    </View>
  );
}
