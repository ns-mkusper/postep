import React, { useMemo, useCallback } from 'react';
import { createEditor, Descendant } from 'slate';
import { Slate, Editable, withReact, RenderElementProps } from 'slate-react';
import { Text as RNText, View } from 'react-native';

interface SlateDocumentProps {
  value: Descendant[];
  readOnly?: boolean;
}

export function SlateDocument({ value, readOnly = true }: SlateDocumentProps) {
  const editor = useMemo(() => withReact(createEditor()), []);
  const renderElement = useCallback((props: RenderElementProps) => {
    const { element, children, attributes } = props;
    if (element.type === 'heading') {
      const depth = (element as any).depth ?? 1;
      const fontSize = Math.max(22 - (depth - 1) * 2, 16);
      return (
        <View {...attributes} style={{ paddingVertical: 4 }}>
          <RNText style={{ fontSize, fontWeight: '700', color: '#F5F6FA' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'list_item') {
      const depth = (element as any).depth ?? 1;
      const ordered = (element as any).ordered ?? false;
      const checked = (element as any).checked;
      const bullet = checked === true ? '☑' : checked === false ? '☐' : ordered ? '1.' : '•';
      return (
        <View
          {...attributes}
          style={{ paddingVertical: 2, paddingLeft: Math.max((depth - 1) * 16, 0) + 16 }}
        >
          <RNText style={{ fontSize: 16, color: '#E3E6EF', lineHeight: 22 }}>
            {`${bullet} `}
            {children}
          </RNText>
        </View>
      );
    }
    if (element.type === 'planning') {
      return (
        <View {...attributes} style={{ paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#21293B', borderRadius: 10 }}>
          <RNText style={{ fontSize: 13, color: '#BFD0FF', fontWeight: '600' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'property_drawer' || element.type === 'drawer') {
      return (
        <View {...attributes} style={{ paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#151922', borderRadius: 10 }}>
          <RNText style={{ fontSize: 12, color: '#8E98B3' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'code_block') {
      return (
        <View {...attributes} style={{ padding: 12, backgroundColor: '#05070B', borderRadius: 10 }}>
          <RNText style={{ fontSize: 13, color: '#A7F3D0', lineHeight: 20, fontFamily: 'monospace' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'table') {
      return (
        <View {...attributes} style={{ padding: 10, backgroundColor: '#111722', borderRadius: 10 }}>
          <RNText style={{ fontSize: 13, color: '#DCE4F9', lineHeight: 20, fontFamily: 'monospace' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'directive') {
      return (
        <View {...attributes} style={{ paddingVertical: 2 }}>
          <RNText style={{ fontSize: 12, color: '#7C879F' }}>{children}</RNText>
        </View>
      );
    }
    if (element.type === 'horizontal_rule') {
      return (
        <View {...attributes} style={{ paddingVertical: 8 }}>
          <RNText style={{ color: '#3B4254' }}>{children}</RNText>
        </View>
      );
    }
    return (
      <View {...attributes} style={{ paddingVertical: 2 }}>
        <RNText style={{ fontSize: 16, color: '#E3E6EF', lineHeight: 22 }}>{children}</RNText>
      </View>
    );
  }, []);

  return (
    <Slate editor={editor} value={value} onChange={() => {}}>
      <Editable
        readOnly={readOnly}
        renderElement={renderElement}
        style={{ padding: 6 }}
      />
    </Slate>
  );
}
