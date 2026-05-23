import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Switch,
  ActivityIndicator,
  ScrollView,
  TextInput,
  useWindowDimensions,
  type GestureResponderEvent
} from 'react-native';
import { DrawerActions } from '@react-navigation/native';
import { router, useNavigation } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { listDocuments, loadDocument, updateDocument, type DocumentRef, type SlateNode } from '@postep/bridge';
import { SlateDocument } from '../../components/SlateDocument';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';
import { useBridgeConfig } from '../../store/orgConfig';
import {
  createBlockViewModels,
  measureInteraction,
  moveRawBlock,
  updateRawBlock,
  type OrgBlockViewModel
} from '../../lib/orgSlateModel';

type NoteLine = {
  text: string;
  checked?: boolean | null;
  kind: 'heading' | 'list' | 'body';
  lineStart?: number;
};

type NoteMetadata = {
  todo?: string | null;
  priority?: string | null;
  scheduled?: string | null;
  deadline?: string | null;
  habit?: boolean;
  properties: Array<{ key: string; value: string }>;
};

type NotePreview = {
  doc: DocumentRef;
  title: string;
  lines: NoteLine[];
  checkedCount: number;
  tags: string[];
  metadata: NoteMetadata;
};

function cleanOrgText(text: string) {
  return text
    .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeTimestamp(text?: string | null) {
  if (!text) {
    return null;
  }
  return text.replace(/[<>]/g, '').replace(/\s+\+\d+[dwmy]/i, '').trim();
}

function isInternalParagraph(text: string) {
  return /^:(LOGBOOK|END):$/i.test(text.trim()) || /^State ".*" from ".*" \[/.test(text.trim());
}

function textForNode(node: SlateNode) {
  if ('text' in node) {
    return cleanOrgText(node.text);
  }
  if (node.type === 'table') {
    return node.rows[0]?.join(' · ') ?? 'Table';
  }
  return cleanOrgText(node.raw);
}


function listItemPreviewText(raw: string, node: Extract<SlateNode, { type: 'list_item' }>) {
  const lines = raw.split('\n');
  const first = lines[node.line_start] ?? '';
  const indent = first.match(/^\s*/)?.[0].length ?? 0;
  const body = [node.text];
  for (let idx = node.line_start + 1; idx < lines.length; idx += 1) {
    const line = lines[idx];
    const trimmed = line.trim();
    const nextIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) {
      break;
    }
    if (/^\*+\s+/.test(trimmed) || /^(SCHEDULED|DEADLINE|CLOSED):/.test(trimmed) || /^#\+/.test(trimmed) || /^:[A-Z0-9_+-]+:$/i.test(trimmed)) {
      break;
    }
    if (/^([-+]|\d+[.)])\s+/.test(trimmed) && nextIndent <= indent) {
      break;
    }
    body.push(trimmed.replace(/^([-+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''));
  }
  return cleanOrgText(body.join('\n'));
}

function titleFromDocument(doc: DocumentRef, nodes: SlateNode[]) {
  const titleDirective = nodes.find((node) => node.type === 'directive' && node.keyword.toUpperCase() === 'TITLE');
  if (titleDirective && 'text' in titleDirective && titleDirective.text.trim()) {
    return titleDirective.text.trim();
  }
  const heading = nodes.find((node) => node.type === 'heading');
  if (heading && 'text' in heading && heading.text.trim()) {
    return heading.text.trim();
  }
  return doc.name.replace(/\.org$/i, '');
}

function buildPreview(doc: DocumentRef, config: { roots: string[]; roamRoots?: string[] }): NotePreview {
  const payload = loadDocument(config, doc.path);
  const title = titleFromDocument(doc, payload.slate);
  const firstHeading = payload.slate.find((node): node is Extract<SlateNode, { type: 'heading' }> => node.type === 'heading');
  const planning = payload.slate.filter((node): node is Extract<SlateNode, { type: 'planning' }> => node.type === 'planning');
  const propertyDrawer = payload.slate.find((node): node is Extract<SlateNode, { type: 'property_drawer' }> => node.type === 'property_drawer');
  const metadata: NoteMetadata = {
    todo: firstHeading?.todo_keyword ?? null,
    priority: firstHeading?.priority ?? null,
    scheduled: humanizeTimestamp(planning.find((node) => node.keyword === 'SCHEDULED')?.text),
    deadline: humanizeTimestamp(planning.find((node) => node.keyword === 'DEADLINE')?.text),
    habit: Boolean(firstHeading?.tags.includes('habit') || propertyDrawer?.properties.STYLE?.toLowerCase() === 'habit'),
    properties: propertyDrawer
      ? Object.entries(propertyDrawer.properties)
          .filter(([key]) => ['STYLE', 'LAST_REPEAT', 'EFFORT'].includes(key.toUpperCase()))
          .map(([key, value]) => ({ key, value }))
      : []
  };
  const lines: NoteLine[] = payload.slate
    .flatMap((node): NoteLine[] => {
      if (node.type === 'heading') {
        const text = textForNode(node);
        return text && text !== title ? [{ text, kind: 'heading' }] : [];
      }
      if (node.type === 'list_item') {
        const text = listItemPreviewText(payload.raw, node);
        return text ? [{ text, checked: node.checked ?? null, kind: 'list', lineStart: node.line_start }] : [];
      }
      if (node.type === 'paragraph') {
        const text = textForNode(node);
        return text && !isInternalParagraph(text) ? [{ text, kind: 'body' }] : [];
      }
      if (node.type === 'table') {
        const text = textForNode(node);
        return text ? [{ text, kind: 'body' }] : [];
      }
      return [];
    })
    .slice(0, 7);
  const checkedCount = payload.slate.filter((node) => node.type === 'list_item' && node.checked).length;
  const tags = Array.from(
    new Set(
      payload.slate
        .filter((node): node is Extract<SlateNode, { type: 'heading' }> => node.type === 'heading')
        .flatMap((node) => node.tags)
    )
  ).slice(0, 3);

  return { doc, title, lines, checkedCount, tags, metadata };
}


function renderOrgNode(node: SlateNode, fallback: Parameters<typeof SlateDocument>[0]['value']) {
  if (node.type === 'heading') {
    return (
      <View style={styles.renderedHeading}>
        <View style={styles.metadataRow}>
          {node.todo_keyword && <Text style={styles.todoChip}>{node.todo_keyword}</Text>}
          {node.priority && <Text style={styles.priorityChip}>Priority {node.priority}</Text>}
          {node.tags.includes('habit') && <Text style={styles.habitChip}>Habit</Text>}
          {node.tags.map((tag) => (
            <Text key={tag} style={styles.tagChip}>#{tag}</Text>
          ))}
        </View>
        <Text style={[styles.renderedHeadingText, node.depth > 1 && styles.renderedSubheadingText]}>{cleanOrgText(node.text)}</Text>
      </View>
    );
  }

  if (node.type === 'planning') {
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>{node.keyword}</Text>
        <Text style={styles.metadataValue}>{humanizeTimestamp(node.text) ?? cleanOrgText(node.text)}</Text>
      </View>
    );
  }

  if (node.type === 'property_drawer') {
    const entries = Object.entries(node.properties);
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>Properties</Text>
        <View style={styles.propertyGrid}>
          {entries.map(([key, value]) => (
            <View key={key} style={styles.propertyPill}>
              <Text style={styles.propertyKey}>{key}</Text>
              <Text style={styles.propertyValue}>{value}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (node.type === 'drawer') {
    const entryCount = node.text.split('\n').filter((line) => line.trim().length > 0).length;
    return (
      <View style={styles.metadataCard}>
        <Text style={styles.metadataLabel}>{node.name}</Text>
        <Text style={styles.metadataValue}>{node.collapsed ? `${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}` : cleanOrgText(node.text)}</Text>
      </View>
    );
  }

  if (node.type === 'paragraph') {
    return <Text style={styles.paragraphText}>{cleanOrgText(node.text)}</Text>;
  }

  if (node.type === 'list_item') {
    return (
      <View style={styles.renderedListItem}>
        <View style={[styles.checkbox, node.checked && styles.checkboxChecked]} />
        <Text style={[styles.paragraphText, node.checked && styles.previewCheckedText]}>{cleanOrgText(node.text)}</Text>
      </View>
    );
  }

  if (node.type === 'table') {
    return (
      <View style={styles.metadataCard}>
        {node.rows.map((row, index) => (
          <Text key={`${row.join(':')}:${index}`} style={styles.monoText}>{row.join('   ')}</Text>
        ))}
      </View>
    );
  }

  if (node.type === 'code_block') {
    return (
      <View style={styles.codeCard}>
        {node.language && <Text style={styles.metadataLabel}>{node.language}</Text>}
        <Text style={styles.codeText}>{node.text}</Text>
      </View>
    );
  }

  if (node.type === 'directive') {
    if (['TITLE', 'CATEGORY'].includes(node.keyword.toUpperCase())) {
      return (
        <View style={styles.metadataCard}>
          <Text style={styles.metadataLabel}>{node.keyword}</Text>
          <Text style={styles.metadataValue}>{cleanOrgText(node.text)}</Text>
        </View>
      );
    }
  }

  return <SlateDocument value={fallback} />;
}


function blockLabel(node: SlateNode) {
  if (node.type === 'heading') {
    return 'Note';
  }
  if (node.type === 'planning') {
    return node.keyword === 'DEADLINE' ? 'Due date' : 'Schedule';
  }
  if (node.type === 'property_drawer') {
    return 'Metadata';
  }
  if (node.type === 'drawer') {
    return node.name === 'LOGBOOK' ? 'History' : node.name;
  }
  return node.type.replace('_', ' ');
}

function isVisibleDocumentBlock(block: OrgBlockViewModel) {
  if (block.node.type === 'directive' && ['TITLE', 'CATEGORY'].includes(block.node.keyword.toUpperCase())) {
    return false;
  }
  return true;
}

function toggleRawCheckbox(raw: string, lineStart: number): string {
  const lines = raw.split('\n');
  const line = lines[lineStart];
  if (!line) {
    return raw;
  }
  if (/^(\s*[-+]\s+)\[ \]/.test(line)) {
    lines[lineStart] = line.replace(/^(\s*[-+]\s+)\[ \]/, '$1[X]');
    return lines.join('\n');
  }
  if (/^(\s*[-+]\s+)\[[xX]\]/.test(line)) {
    lines[lineStart] = line.replace(/^(\s*[-+]\s+)\[[xX]\]/, '$1[ ]');
    return lines.join('\n');
  }
  return raw;
}

export default function LibraryScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const bridgeConfig = useBridgeConfig();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(false);
  const [showDocument, setShowDocument] = useState(true);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const numColumns = width >= 520 ? 2 : 1;

  const documentsQuery = useQuery({
    queryKey: ['documents', bridgeConfig.roots.join(':'), bridgeConfig.roamRoots?.join(':') ?? ''],
    queryFn: () =>
      bridgeConfig.roots.length === 0
        ? Promise.resolve([])
        : Promise.resolve(listDocuments(bridgeConfig))
  });

  useEffect(() => {
    if (documentsQuery.data && selectedPath) {
      const stillExists = documentsQuery.data.some((doc) => doc.path === selectedPath);
      if (!stillExists) {
        setSelectedPath(null);
      }
    }
  }, [documentsQuery.data, selectedPath]);

  const noteGrid = useMemo(() => {
    if (!documentsQuery.data || bridgeConfig.roots.length === 0) {
      return { value: [] as NotePreview[], metric: { elapsedMs: 0 } };
    }
    return measureInteraction('noteGrid', () =>
      documentsQuery.data.map((doc) => buildPreview(doc, bridgeConfig))
    );
  }, [bridgeConfig, documentsQuery.data]);

  const documentQuery = useQuery({
    queryKey: ['document', selectedPath, bridgeConfig.roots.join(':'), bridgeConfig.roamRoots?.join(':') ?? ''],
    enabled: Boolean(selectedPath) && bridgeConfig.roots.length > 0,
    queryFn: () => Promise.resolve(loadDocument(bridgeConfig, selectedPath!))
  });

  const blockModel = useMemo(() =>
    measureInteraction('slateProjection', () =>
      createBlockViewModels(documentQuery.data?.slate ?? [], documentQuery.data?.raw ?? '', {
        outlineOnly,
        readerMode
      })
    ), [documentQuery.data?.raw, documentQuery.data?.slate, outlineOnly, readerMode]);
  const blocks = blockModel.value;
  const visibleBlocks = useMemo(() => blocks.filter(isVisibleDocumentBlock), [blocks]);
  const selectedName = documentsQuery.data?.find((doc) => doc.path === selectedPath)?.name ?? 'Org note';

  useEffect(() => {
    const metric = selectedPath ? blockModel.metric.elapsedMs : noteGrid.metric.elapsedMs;
    const label = selectedPath ? 'Render model' : 'Card grid';
    setInteractionStatus(`${label} ${metric.toFixed(2)}ms`);
  }, [blockModel.metric.elapsedMs, noteGrid.metric.elapsedMs, selectedPath]);

  const onRefreshDocuments = () => {
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'documents' });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'document' });
  };

  useBridgeEvent('documentsChanged', onRefreshDocuments);
  useBridgeEvent('rootsChanged', onRefreshDocuments);

  const persistRaw = (raw: string, label: string) => {
    if (!selectedPath || bridgeConfig.roots.length === 0) {
      return;
    }
    const { value: payload, metric } = measureInteraction(label, () =>
      updateDocument({
        roots: bridgeConfig.roots,
        roamRoots: bridgeConfig.roamRoots,
        path: selectedPath,
        raw
      })
    );
    queryClient.setQueryData(['document', selectedPath, bridgeConfig.roots.join(':'), bridgeConfig.roamRoots?.join(':') ?? ''], payload);
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'agenda' });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'documents' });
    setInteractionStatus(`${label} ${metric.elapsedMs.toFixed(2)}ms`);
  };

  const startEditing = (block: OrgBlockViewModel) => {
    setEditingBlockId(block.id);
    setDraftRaw(block.rawText);
  };

  const saveBlockEdit = (block: OrgBlockViewModel) => {
    const raw = documentQuery.data?.raw ?? '';
    const nextRaw = updateRawBlock(raw, block.node, draftRaw);
    persistRaw(nextRaw, 'blockEdit');
    setEditingBlockId(null);
    setDraftRaw('');
  };

  const moveBlock = (block: OrgBlockViewModel, direction: -1 | 1) => {
    const raw = documentQuery.data?.raw ?? '';
    const { value: nextRaw, metric } = measureInteraction('blockMove', () =>
      moveRawBlock(raw, block.node, direction)
    );
    setInteractionStatus(`blockMove ${metric.elapsedMs.toFixed(2)}ms`);
    if (nextRaw !== raw) {
      persistRaw(nextRaw, 'persistMove');
    }
  };

  const openDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  const toggleChecklistItem = (path: string, lineStart?: number) => {
    if (lineStart === undefined || bridgeConfig.roots.length === 0) {
      return;
    }
    const payload = loadDocument(bridgeConfig, path);
    const nextRaw = toggleRawCheckbox(payload.raw, lineStart);
    if (nextRaw === payload.raw) {
      return;
    }
    const { value: nextPayload, metric } = measureInteraction('checklistToggle', () =>
      updateDocument({
        roots: bridgeConfig.roots,
        roamRoots: bridgeConfig.roamRoots,
        path,
        raw: nextRaw
      })
    );
    queryClient.setQueryData(['document', path, bridgeConfig.roots.join(':'), bridgeConfig.roamRoots?.join(':') ?? ''], nextPayload);
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'documents' });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'agenda' });
    setInteractionStatus(`checklistToggle ${metric.elapsedMs.toFixed(2)}ms`);
  };

  const handleChecklistPress = (event: GestureResponderEvent, path: string, lineStart?: number) => {
    event.stopPropagation();
    toggleChecklistItem(path, lineStart);
  };

  const openNote = (path: string) => setSelectedPath(path);

  const renderPreviewLine = (item: NotePreview, line: NoteLine, index: number) => {
    if (line.kind === 'list') {
      return (
        <View key={`${line.text}:${index}`} style={styles.previewLine}>
          <TouchableOpacity
            testID={`note-checkbox-${item.doc.name}-${line.lineStart ?? index}`}
            onPress={(event) => handleChecklistPress(event, item.doc.path, line.lineStart)}
            style={[styles.checkbox, line.checked && styles.checkboxChecked]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(line.checked) }}
          />
          <TouchableOpacity style={styles.previewTextButton} onPress={() => openNote(item.doc.path)} activeOpacity={0.75}>
            <Text numberOfLines={index > 3 ? 1 : 3} style={[styles.previewText, line.checked && styles.previewCheckedText]}>
              {line.text}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        key={`${line.text}:${index}`}
        style={[styles.previewLine, line.kind === 'heading' && styles.previewHeadingLine]}
        onPress={() => openNote(item.doc.path)}
        activeOpacity={0.75}
      >
        <View style={line.kind === 'heading' ? styles.previewHeadingSpacer : styles.previewBullet} />
        <Text numberOfLines={index > 3 ? 1 : 2} style={[styles.previewText, line.kind === 'heading' && styles.previewHeadingText]}>
          {line.text}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderNoteCard = ({ item }: { item: NotePreview }) => (
    <View
      style={styles.noteCard}
      testID={`document-card-${item.doc.name}`}
    >
      <TouchableOpacity onPress={() => openNote(item.doc.path)} activeOpacity={0.78}>
        <Text style={styles.noteTitle}>{item.title}</Text>
        <View style={styles.metadataRow}>
          {item.metadata.todo && <Text style={styles.todoChip}>{item.metadata.todo}</Text>}
          {item.metadata.priority && <Text style={styles.priorityChip}>#{item.metadata.priority}</Text>}
          {item.metadata.habit && <Text style={styles.habitChip}>Habit</Text>}
          {item.metadata.scheduled && <Text style={styles.metaChip}>Scheduled {item.metadata.scheduled}</Text>}
          {item.metadata.deadline && <Text style={styles.deadlineChip}>Due {item.metadata.deadline}</Text>}
        </View>
      </TouchableOpacity>
      <View style={styles.previewLines}>
        {item.lines.map((line, index) => renderPreviewLine(item, line, index))}
      </View>
      {item.checkedCount > 0 && <Text style={styles.checkedSummary}>+ {item.checkedCount} checked items</Text>}
      {item.tags.length > 0 && (
        <TouchableOpacity style={styles.tagRow} onPress={() => openNote(item.doc.path)} activeOpacity={0.78}>
          {item.tags.map((tag) => (
            <Text key={tag} style={styles.tagChip}>#{tag}</Text>
          ))}
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container} testID="documents-screen">
      <View style={styles.postepHeader}>
        <TouchableOpacity testID="hamburger-menu" onPress={openDrawer} style={styles.iconButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.searchPill} activeOpacity={0.85} onPress={() => setSelectedPath(null)}>
          <Text style={styles.searchText} testID="org-library-title">Search Postep</Text>
          <Text style={styles.searchIcon}>▭</Text>
          <Text style={styles.searchIcon}>↕</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.avatarButton} onPress={onRefreshDocuments} testID="refresh-notes">
          <Text style={styles.avatarText}>P</Text>
        </TouchableOpacity>
      </View>

      {!selectedPath ? (
        <View style={styles.gridScreen}>
          <View style={styles.gridMetaRow}>
            <Text style={styles.gridMeta}>Local Org · {documentsQuery.data?.length ?? 0} notes</Text>
            {interactionStatus && <Text style={styles.latencyText}>{interactionStatus}</Text>}
          </View>
          <FlatList
            key={`notes-${numColumns}`}
            testID="document-chip-list"
            data={noteGrid.value}
            numColumns={numColumns}
            keyExtractor={(item) => item.doc.path}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
            contentContainerStyle={styles.noteGrid}
            ListEmptyComponent={() => (
              <View style={styles.emptyDocs}>
                <Text style={styles.emptyDocsText}>Add an Org root from the menu to see notes.</Text>
              </View>
            )}
            renderItem={renderNoteCard}
          />
          <TouchableOpacity testID="capture-fab" style={styles.fab} onPress={() => router.push('/capture')}>
            <Text style={styles.fabText}>＋</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.editorScreen}>
          <View style={styles.documentTopBar}>
            <TouchableOpacity onPress={() => setSelectedPath(null)} style={styles.backButton} testID="back-to-notes">
              <Text style={styles.backButtonText}>‹ Notes</Text>
            </TouchableOpacity>
            <View style={styles.editorTitleBlock}>
              <Text style={styles.editorTitle} numberOfLines={1}>{selectedName}</Text>
              {interactionStatus && <Text style={styles.latencyText}>{interactionStatus}</Text>}
            </View>
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Reader</Text>
              <Switch value={readerMode} onValueChange={setReaderMode} />
            </View>
            <View style={styles.switchItem}>
              <Text style={styles.switchLabel}>Outline</Text>
              <Switch value={outlineOnly} onValueChange={setOutlineOnly} />
            </View>
            <TouchableOpacity style={styles.actionButton} onPress={() => setShowDocument((v) => !v)}>
              <Text style={styles.actionButtonText}>{showDocument ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          {showDocument && (
            <ScrollView testID="document-scroll" style={styles.documentScroll} contentContainerStyle={{ paddingBottom: 48 }}>
              {documentQuery.isFetching && <ActivityIndicator style={{ marginVertical: 24 }} color="#AFC0FF" />}
              {!documentQuery.isFetching && documentQuery.data && blocks.length > 0 && (
                <View style={styles.blocksContainer}>
                  {visibleBlocks.map((block) => {
                    const isEditing = editingBlockId === block.id;
                    return (
                      <View
                        key={block.id}
                        testID={`org-block-card-${block.node.type}-${block.node.line_start}`}
                        style={[styles.blockCard, block.node.type === 'heading' && styles.headingCard]}
                      >
                        <View style={styles.blockToolbar}>
                          <Text style={styles.blockType}>{blockLabel(block.node)}</Text>
                          <View style={styles.blockActions}>
                            <TouchableOpacity testID={`block-move-up-${block.node.line_start}`} onPress={() => moveBlock(block, -1)} style={styles.smallAction}>
                              <Text style={styles.smallActionText}>↑</Text>
                            </TouchableOpacity>
                            <TouchableOpacity testID={`block-move-down-${block.node.line_start}`} onPress={() => moveBlock(block, 1)} style={styles.smallAction}>
                              <Text style={styles.smallActionText}>↓</Text>
                            </TouchableOpacity>
                            <TouchableOpacity testID={`block-edit-${block.node.line_start}`} onPress={() => startEditing(block)} style={styles.smallAction}>
                              <Text style={styles.smallActionText}>Edit</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        {isEditing ? (
                          <View>
                            <TextInput
                              testID="block-editor"
                              style={styles.blockEditor}
                              value={draftRaw}
                              onChangeText={setDraftRaw}
                              multiline
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                            <View style={styles.editActions}>
                              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditingBlockId(null)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity testID="block-save" style={styles.saveButton} onPress={() => saveBlockEdit(block)}>
                                <Text style={styles.saveText}>Save</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          renderOrgNode(block.node, block.descendants)
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {!documentQuery.isFetching && (!documentQuery.data || blocks.length === 0) && (
                <Text style={styles.emptyDocument}>Select an Org file to view its contents.</Text>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111217' },
  postepHeader: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#111217'
  },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { color: '#D7D9E3', fontSize: 34, lineHeight: 38 },
  searchPill: {
    flex: 1,
    minHeight: 58,
    borderRadius: 32,
    backgroundColor: '#2A2C36',
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20
  },
  searchText: { flex: 1, color: '#B5B6C2', fontSize: 30, fontWeight: '400' },
  searchIcon: { color: '#BFC2CF', fontSize: 30, fontWeight: '700' },
  avatarButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    borderColor: '#5B8DEF',
    backgroundColor: '#242B35',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: { color: '#F3F5FF', fontWeight: '800', fontSize: 22 },
  gridScreen: { flex: 1 },
  gridMetaRow: { paddingHorizontal: 22, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridMeta: { color: '#8C8F9D', fontSize: 13 },
  latencyText: { color: '#9AA0AE', fontSize: 11 },
  noteGrid: { paddingHorizontal: 20, paddingBottom: 120 },
  columnWrapper: { gap: 20, alignItems: 'flex-start' },
  noteCard: {
    flex: 1,
    backgroundColor: '#101116',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#424550',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    marginBottom: 20,
    minHeight: 164
  },
  noteTitle: { color: '#ECEEF8', fontSize: 27, fontWeight: '800', marginBottom: 12 },
  metadataRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' },
  todoChip: { color: '#111217', backgroundColor: '#B8C6F4', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, fontWeight: '900', overflow: 'hidden' },
  priorityChip: { color: '#FFE8A3', backgroundColor: '#3A321A', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  habitChip: { color: '#BDF7D3', backgroundColor: '#173828', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  metaChip: { color: '#C8D2F0', backgroundColor: '#242A3C', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, overflow: 'hidden' },
  deadlineChip: { color: '#FFD0D0', backgroundColor: '#3B2024', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, fontWeight: '800', overflow: 'hidden' },
  previewLines: { gap: 10 },
  previewLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  previewHeadingLine: { marginTop: 12 },
  previewTextButton: { flex: 1 },
  checkbox: { width: 21, height: 21, borderRadius: 3, borderWidth: 2.5, borderColor: '#9A9DA8', marginTop: 3 },
  previewBullet: { width: 21, height: 21, marginTop: 3, alignItems: 'center', justifyContent: 'center' },
  previewHeadingSpacer: { width: 21, height: 21, marginTop: 3 },
  checkboxChecked: { backgroundColor: '#AEB4C8', borderColor: '#AEB4C8' },
  previewText: { flex: 1, color: '#E3E6F0', fontSize: 23, lineHeight: 30 },
  previewHeadingText: { fontWeight: '700', color: '#F0F2FA' },
  previewCheckedText: { color: '#8E929D', textDecorationLine: 'line-through' },
  checkedSummary: { color: '#8C8F9A', fontSize: 19, marginTop: 20, marginLeft: 32 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tagChip: { color: '#C7CBE0', backgroundColor: '#2D3039', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12, overflow: 'hidden' },
  emptyDocs: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyDocsText: { color: '#858A98', fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 28,
    bottom: 34,
    width: 92,
    height: 92,
    borderRadius: 28,
    backgroundColor: '#B8C6F4',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fabText: { color: '#202234', fontSize: 52, lineHeight: 58, fontWeight: '300' },
  editorScreen: { flex: 1, backgroundColor: '#101116' },
  documentTopBar: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 14
  },
  backButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#252832' },
  backButtonText: { color: '#EEF1FA', fontSize: 16, fontWeight: '700' },
  editorTitleBlock: { flex: 1 },
  editorTitle: { color: '#F2F4FC', fontSize: 18, fontWeight: '800' },
  switchRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)'
  },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { color: '#D8DCEE' },
  actionButton: { backgroundColor: '#30333E', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center' },
  actionButtonText: { color: '#F0F2FC', fontWeight: '700' },
  documentScroll: { flex: 1, backgroundColor: '#0E0F14' },
  blocksContainer: { padding: 12 },
  blockCard: { backgroundColor: '#181A21', borderRadius: 18, padding: 12, marginBottom: 12, borderWidth: 1.5, borderColor: '#3C404B' },
  headingCard: { borderColor: '#575B6A', backgroundColor: '#14161D' },
  renderedHeading: { paddingVertical: 4 },
  renderedHeadingText: { color: '#F4F6FF', fontSize: 24, lineHeight: 30, fontWeight: '800' },
  renderedSubheadingText: { fontSize: 20, lineHeight: 26 },
  metadataCard: { backgroundColor: '#111620', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#303746' },
  metadataLabel: { color: '#8EA0C3', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 },
  metadataValue: { color: '#E4E8F5', fontSize: 15, lineHeight: 21 },
  propertyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  propertyPill: { backgroundColor: '#202633', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#364055' },
  propertyKey: { color: '#8EA0C3', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  propertyValue: { color: '#F0F3FC', fontSize: 13, marginTop: 2 },
  paragraphText: { color: '#E4E8F5', fontSize: 16, lineHeight: 23 },
  renderedListItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  monoText: { color: '#DCE4F9', fontSize: 13, lineHeight: 20, fontFamily: 'monospace' },
  codeCard: { backgroundColor: '#070A10', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#243040' },
  codeText: { color: '#A7F3D0', fontSize: 13, lineHeight: 20, fontFamily: 'monospace' },
  blockToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  blockType: { color: '#8F98B2', fontSize: 11, textTransform: 'uppercase' },
  blockActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallAction: { backgroundColor: '#252B3B', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  smallActionText: { color: '#DDE4FA', fontSize: 12, fontWeight: '600' },
  blockEditor: { minHeight: 88, color: '#F4F7FE', backgroundColor: '#0C0F16', borderRadius: 10, padding: 12, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  cancelButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#272D3B' },
  cancelText: { color: '#CCD4E8', fontWeight: '600' },
  saveButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#4C6EF5' },
  saveText: { color: '#FFFFFF', fontWeight: '700' },
  emptyDocument: { color: '#6E7588', padding: 24 }
});
