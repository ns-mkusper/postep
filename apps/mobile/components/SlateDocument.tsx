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
      const bullet = ordered ? '•' : '–';
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
        style={{ padding: 16 }}
      />
    </Slate>
  );
}
