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
  Platform
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { listDocuments, loadDocument, updateDocument } from '@postep/bridge';
import { SlateDocument } from '../../components/SlateDocument';
import { useBridgeEvent } from '../../hooks/useBridgeEvent';
import { useBridgeConfig, useOrgConfig } from '../../store/orgConfig';
import {
  createBlockViewModels,
  measureInteraction,
  moveRawBlock,
  updateRawBlock,
  type OrgBlockViewModel
} from '../../lib/orgSlateModel';

export default function LibraryScreen() {
  const queryClient = useQueryClient();
  const bridgeConfig = useBridgeConfig();
  const roots = useOrgConfig((state) => state.roots);
  const roamRoots = useOrgConfig((state) => state.roamRoots);
  const addRoot = useOrgConfig((state) => state.addRoot);
  const removeRoot = useOrgConfig((state) => state.removeRoot);
  const addRoamRoot = useOrgConfig((state) => state.addRoamRoot);
  const removeRoamRoot = useOrgConfig((state) => state.removeRoamRoot);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState(false);
  const [outlineOnly, setOutlineOnly] = useState(false);
  const [newRoot, setNewRoot] = useState('');
  const [newRoamRoot, setNewRoamRoot] = useState('');
  const [pickerStatus, setPickerStatus] = useState<string | null>(null);
  const [showDocument, setShowDocument] = useState(true);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);
  const isAndroid = Platform.OS === 'android';

  const documentsQuery = useQuery({
    queryKey: ['documents', bridgeConfig.roots.join(':'), bridgeConfig.roamRoots?.join(':') ?? ''],
    queryFn: () =>
      bridgeConfig.roots.length === 0
        ? Promise.resolve([])
        : Promise.resolve(listDocuments(bridgeConfig))
  });

  useEffect(() => {
    if (!selectedPath && documentsQuery.data && documentsQuery.data.length > 0) {
      setSelectedPath(documentsQuery.data[0].path);
    }
  }, [documentsQuery.data, selectedPath]);

  useEffect(() => {
    if (documentsQuery.data && selectedPath) {
      const stillExists = documentsQuery.data.some((doc) => doc.path === selectedPath);
      if (!stillExists) {
        setSelectedPath(documentsQuery.data[0]?.path ?? null);
      }
    }
  }, [documentsQuery.data, selectedPath]);

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

  useEffect(() => {
    setInteractionStatus(`Render model ${blockModel.metric.elapsedMs.toFixed(2)}ms`);
  }, [blockModel.metric.elapsedMs]);

  const onRefreshDocuments = () => {
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'documents' });
    if (selectedPath) {
      queryClient.invalidateQueries({ queryKey: ['document', selectedPath] });
    }
  };

  useBridgeEvent('documentsChanged', onRefreshDocuments);
  useBridgeEvent('rootsChanged', onRefreshDocuments);

  const handleAddRoot = () => {
    if (!newRoot.trim()) {
      return;
    }
    addRoot(newRoot.trim());
    setNewRoot('');
  };

  const handleAddRoamRoot = () => {
    if (!newRoamRoot.trim()) {
      return;
    }
    addRoamRoot(newRoamRoot.trim());
    setNewRoamRoot('');
  };

  const handlePickOrgRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } = await import('@postep/bridge/platform/android/saf');
      const handle = await requestOrgDirectory();
      addRoot(handle.uri);
      setPickerStatus(`Added ${handle.uri}`);
    } catch (error) {
      setPickerStatus('Picker cancelled or failed');
      console.warn('SAF picker failed', error);
    }
  };

  const handlePickRoamRoot = async () => {
    if (!isAndroid) {
      return;
    }
    try {
      const { requestOrgDirectory } = await import('@postep/bridge/platform/android/saf');
      const handle = await requestOrgDirectory();
      addRoamRoot(handle.uri);
      setPickerStatus(`Added roam ${handle.uri}`);
    } catch (error) {
      setPickerStatus('Picker cancelled or failed');
      console.warn('SAF picker failed', error);
    }
  };

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

  return (
    <View style={styles.container}>
      <View style={styles.statusBar}>
        <Text style={styles.statusTitle}>Org Library</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusPill}>Local Org · {documentsQuery.data?.length ?? 0} files</Text>
          <TouchableOpacity onPress={onRefreshDocuments} style={styles.refreshButton}>
            <Text style={styles.refreshText}>Reload</Text>
          </TouchableOpacity>
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
        {interactionStatus && <Text style={styles.latencyText}>{interactionStatus}</Text>}
      </View>

      <View style={styles.rootManager}>
        <Text style={styles.sectionHeading}>Org Roots</Text>
        <View style={styles.chipRow}>
          {roots.map((root) => (
            <View key={root} style={styles.rootChip}>
              <Text style={styles.rootChipText}>{root}</Text>
              <TouchableOpacity style={styles.removeChipBtn} onPress={() => removeRoot(root)}>
                <Text style={styles.removeChipText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.pathInput}
            value={newRoot}
            onChangeText={setNewRoot}
            placeholder="/storage/emulated/0/Documents/org"
            placeholderTextColor="#4F566B"
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddRoot}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        {isAndroid && (
          <TouchableOpacity style={styles.pickerButton} onPress={handlePickOrgRoot}>
            <Text style={styles.pickerText}>Pick via Android SAF</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionHeading, { marginTop: 16 }]}>Org-roam Roots</Text>
        <View style={styles.chipRow}>
          {roamRoots.map((root) => (
            <View key={root} style={styles.rootChip}>
              <Text style={styles.rootChipText}>{root}</Text>
              <TouchableOpacity style={styles.removeChipBtn} onPress={() => removeRoamRoot(root)}>
                <Text style={styles.removeChipText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.pathInput}
            value={newRoamRoot}
            onChangeText={setNewRoamRoot}
            placeholder="/storage/emulated/0/Documents/org-roam"
            placeholderTextColor="#4F566B"
          />
          <TouchableOpacity style={styles.addButton} onPress={handleAddRoamRoot}>
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
        {isAndroid && (
          <TouchableOpacity style={styles.pickerButton} onPress={handlePickRoamRoot}>
            <Text style={styles.pickerText}>Pick Roam Directory</Text>
          </TouchableOpacity>
        )}
        {pickerStatus && <Text style={styles.pickerStatus}>{pickerStatus}</Text>}
      </View>

      <FlatList
        data={documentsQuery.data ?? []}
        horizontal
        keyExtractor={(item) => item.path}
        contentContainerStyle={styles.docList}
        ListEmptyComponent={() => (
          <View style={styles.emptyDocs}>
            <Text style={styles.emptyDocsText}>Add an Org root to see documents.</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.docChip, selectedPath === item.path && styles.docChipSelected]}
            onPress={() => setSelectedPath(item.path)}
          >
            <Text style={styles.docChipText}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionButton} onPress={() => setShowDocument((v) => !v)}>
          <Text style={styles.actionButtonText}>{showDocument ? 'Hide Document' : 'Show Document'}</Text>
        </TouchableOpacity>
        <Text style={styles.actionHint}>Edit, save, and move org blocks without leaving the rendered document.</Text>
      </View>

      {showDocument && (
        <ScrollView style={styles.documentScroll} contentContainerStyle={{ paddingBottom: 48 }}>
          {documentQuery.isFetching && <ActivityIndicator style={{ marginVertical: 24 }} color="#4C6EF5" />}
          {!documentQuery.isFetching && documentQuery.data && blocks.length > 0 && (
            <View style={styles.blocksContainer}>
              {blocks.map((block) => {
                const isEditing = editingBlockId === block.id;
                return (
                  <View key={block.id} style={[styles.blockCard, block.node.type === 'heading' && styles.headingCard]}>
                    <View style={styles.blockToolbar}>
                      <Text style={styles.blockType}>{block.node.type.replace('_', ' ')}</Text>
                      <View style={styles.blockActions}>
                        <TouchableOpacity onPress={() => moveBlock(block, -1)} style={styles.smallAction}>
                          <Text style={styles.smallActionText}>↑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => moveBlock(block, 1)} style={styles.smallAction}>
                          <Text style={styles.smallActionText}>↓</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => startEditing(block)} style={styles.smallAction}>
                          <Text style={styles.smallActionText}>Edit</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {isEditing ? (
                      <View>
                        <TextInput
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
                          <TouchableOpacity style={styles.saveButton} onPress={() => saveBlockEdit(block)}>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101214' },
  statusBar: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)'
  },
  statusTitle: { fontSize: 20, color: '#F4F7FE', fontWeight: '600' },
  statusRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: {
    backgroundColor: '#1D2331',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    color: '#97A0B8',
    fontSize: 12
  },
  refreshButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: '#273047' },
  refreshText: { color: '#C7CFE4', fontSize: 12 },
  switchRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)'
  },
  switchItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { color: '#D8DCEE' },
  latencyText: { color: '#6EE7B7', fontSize: 11 },
  rootManager: { paddingHorizontal: 16, paddingVertical: 20 },
  sectionHeading: { color: '#8F98B2', fontSize: 12, marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  rootChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2430',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8
  },
  rootChipText: { color: '#E4E8F5', marginRight: 6 },
  removeChipBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#303546', alignItems: 'center', justifyContent: 'center' },
  removeChipText: { color: '#F87171', fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  pathInput: { flex: 1, backgroundColor: '#191D27', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#EEF1FB' },
  addButton: { backgroundColor: '#4C6EF5', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, marginLeft: 12 },
  addButtonText: { color: '#FFFFFF', fontWeight: '600' },
  pickerButton: { marginTop: 8, backgroundColor: '#273047', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  pickerText: { color: '#C7CFE4', fontWeight: '600' },
  pickerStatus: { marginTop: 8, color: '#6E7588' },
  docList: { paddingHorizontal: 16, paddingVertical: 12 },
  docChip: { borderRadius: 12, borderWidth: 1, borderColor: '#1F2430', paddingVertical: 10, paddingHorizontal: 16, marginRight: 12 },
  docChipSelected: { backgroundColor: '#1F2430', borderColor: '#4C6EF5' },
  docChipText: { color: '#D8DEEF', fontSize: 14 },
  emptyDocs: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyDocsText: { color: '#6E7588' },
  documentScroll: { flex: 1, backgroundColor: '#0E1118' },
  actionsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  actionButton: { backgroundColor: '#364180', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  actionButtonText: { color: '#F0F2FC', fontWeight: '600' },
  actionHint: { marginTop: 8, color: '#77809A', fontSize: 12 },
  blocksContainer: { padding: 12 },
  blockCard: { backgroundColor: '#181C24', borderRadius: 16, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  headingCard: { borderColor: 'rgba(76,110,245,0.42)', backgroundColor: '#151A2A' },
  blockToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
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
