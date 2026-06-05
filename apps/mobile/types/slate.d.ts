import type { BaseEditor } from 'slate';
import type { ReactEditor } from 'slate-react';

type CustomText = { text: string };

type CustomElement =
  | { type: 'heading'; depth?: number; children: CustomText[] }
  | { type: 'list_item'; depth?: number; ordered?: boolean; checked?: boolean | null; children: CustomText[] }
  | { type: 'planning'; children: CustomText[] }
  | { type: 'property_drawer'; children: CustomText[] }
  | { type: 'drawer'; children: CustomText[] }
  | { type: 'code_block'; language?: string | null; children: CustomText[] }
  | { type: 'table'; rows?: string[][]; children: CustomText[] }
  | { type: 'directive'; children: CustomText[] }
  | { type: 'horizontal_rule'; children: CustomText[] }
  | { type: 'paragraph'; children: CustomText[] };

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
