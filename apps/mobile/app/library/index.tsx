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
  useWindowDimensions
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

type NotePreview = {
  doc: DocumentRef;
  title: string;
  lines: Array<{ text: string; checked?: boolean | null }>;
  checkedCount: number;
  tags: string[];
};

function textForNode(node: SlateNode) {
  if ('text' in node) {
    return node.text.trim();
  }
  if (node.type === 'table') {
    return node.rows[0]?.join(' · ') ?? 'Table';
  }
  return node.raw.trim();
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
  const contentNodes = payload.slate.filter((node) => {
    if (node.type === 'directive' && node.keyword.toUpperCase() === 'TITLE') {
      return false;
    }
    return ['heading', 'list_item', 'paragraph', 'planning', 'table', 'code_block'].includes(node.type);
  });
  const lines = contentNodes
    .map((node) => ({ text: textForNode(node), checked: node.type === 'list_item' ? node.checked : null }))
    .filter((line) => line.text.length > 0 && line.text !== title)
    .slice(0, 9);
  const checkedCount = payload.slate.filter((node) => node.type === 'list_item' && node.checked).length;
  const tags = Array.from(
    new Set(
      payload.slate
        .filter((node): node is Extract<SlateNode, { type: 'heading' }> => node.type === 'heading')
        .flatMap((node) => node.tags)
    )
  ).slice(0, 3);

  return { doc, title, lines, checkedCount, tags };
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

  const renderNoteCard = ({ item }: { item: NotePreview }) => (
    <TouchableOpacity
      style={styles.noteCard}
      onPress={() => setSelectedPath(item.doc.path)}
      testID={`document-card-${item.doc.name}`}
      activeOpacity={0.78}
    >
      <Text style={styles.noteTitle}>{item.title}</Text>
      <View style={styles.previewLines}>
        {item.lines.map((line, index) => (
          <View key={`${line.text}:${index}`} style={styles.previewLine}>
            <View style={[styles.checkbox, line.checked && styles.checkboxChecked]} />
            <Text numberOfLines={index > 3 ? 1 : 2} style={[styles.previewText, line.checked && styles.previewCheckedText]}>
              {line.text}
            </Text>
          </View>
        ))}
      </View>
      {item.checkedCount > 0 && <Text style={styles.checkedSummary}>+ {item.checkedCount} checked items</Text>}
      {item.tags.length > 0 && (
        <View style={styles.tagRow}>
          {item.tags.map((tag) => (
            <Text key={tag} style={styles.tagChip}>#{tag}</Text>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container} testID="documents-screen">
      <View style={styles.keepHeader}>
        <TouchableOpacity testID="hamburger-menu" onPress={openDrawer} style={styles.iconButton}>
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.searchPill} activeOpacity={0.85} onPress={() => setSelectedPath(null)}>
          <Text style={styles.searchText} testID="org-library-title">Search Keep</Text>
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
                  {blocks.map((block) => {
                    const isEditing = editingBlockId === block.id;
                    return (
                      <View
                        key={block.id}
                        testID={`org-block-card-${block.node.type}-${block.node.line_start}`}
                        style={[styles.blockCard, block.node.type === 'heading' && styles.headingCard]}
                      >
                        <View style={styles.blockToolbar}>
                          <Text style={styles.blockType}>{block.node.type.replace('_', ' ')}</Text>
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
                          <SlateDocument value={block.descendants} />
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
  keepHeader: {
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
  noteTitle: { color: '#ECEEF8', fontSize: 27, fontWeight: '800', marginBottom: 18 },
  previewLines: { gap: 10 },
  previewLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 21, height: 21, borderRadius: 3, borderWidth: 2.5, borderColor: '#9A9DA8', marginTop: 3 },
  checkboxChecked: { backgroundColor: '#AEB4C8', borderColor: '#AEB4C8' },
  previewText: { flex: 1, color: '#E3E6F0', fontSize: 23, lineHeight: 30 },
  previewCheckedText: { color: '#8E929D', textDecorationLine: 'line-through' },
  checkedSummary: { color: '#8C8F9A', fontSize: 19, marginTop: 20, marginLeft: 32 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tagChip: { color: '#C7CBE0', backgroundColor: '#2D3039', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontSize: 12 },
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
