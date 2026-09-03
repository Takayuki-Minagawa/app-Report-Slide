'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import { useAppPreferences } from '@/components/app-preferences';
import {
  createDefaultDocument,
  toEditorDocument,
  type DocumentData,
  type DocumentNode,
  type DocumentType,
} from '@/src/document/model';
import type { DocumentFlag } from '@/src/document/metadata';
import { migrateDocumentData } from '@/src/document/validation';
import {
  analyzeDocument,
  isSemanticNode,
  type SemanticNode,
} from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import { createEditorExtensions } from '@/src/editor/extensions';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  serializeDocument,
  MarkdownSerializationError,
} from '@/src/markdown/serializer';
import {
  cloneDocument,
  initialDocument,
  initialMarkdown,
} from '@/src/workspace/initial-document';
import {
  readWorkspaceFiles,
  revokeAssetUrls,
  downloadDocument,
  downloadFile,
  type AssetUrls,
  type DocumentFileFormat,
} from '@/src/workspace/files';
import {
  statusMessage,
  diagnosticStatusMessage,
  statusMessageText,
  statusDescriptionText,
  combinedStatusDescription,
  describeWorkspaceError,
  WorkspaceStatusError,
  type StatusMessage,
  type StatusDescription,
  type WorkspaceStatus,
} from '@/src/workspace/status';
import { useDocumentSelection } from './use-document-selection';

export type WorkspaceView = 'visual' | 'markdown' | 'preview';

interface LoadDocumentOptions {
  assets?: AssetUrls;
  description?: StatusDescription;
}

function currentDocument(
  editor: Editor | null,
  document: DocumentData,
): DocumentData {
  const content = editor?.getJSON().content;
  return {
    ...document,
    children: Array.isArray(content)
      ? (content as DocumentNode[])
      : document.children,
  };
}

/** Owns document replacement, drafts and imports; selection and rendering stay separate. */
export function useDocumentWorkspace() {
  const { copy, locale } = useAppPreferences();
  const [document, setDocument] = useState<DocumentData>(() =>
    cloneDocument(initialDocument),
  );
  const [view, setView] = useState<WorkspaceView>('visual');
  const [markdownDraft, setMarkdownDraft] = useState(initialMarkdown);
  const [editorSource, setEditorSource] = useState(() => ({
    revision: 0,
    document: cloneDocument(initialDocument),
  }));
  const [status, setStatus] = useState<WorkspaceStatus>({
    kind: 'idle',
    title: statusMessage('ready'),
    description: statusMessage('readyDescription'),
  });
  const [documentDirty, setDocumentDirty] = useState(false);
  const [markdownDirty, setMarkdownDirty] = useState(false);
  const [assets, setAssets] = useState<AssetUrls>(() => new Map());
  const ownedAssets = useRef(assets);
  const [htmlExporting, setHtmlExporting] = useState(false);
  const activeHtmlExport = useRef<number | null>(null);
  const importRevision = useRef(0);
  const invalidatePendingImport = useCallback(() => {
    importRevision.current++;
  }, []);
  useEffect(() => invalidatePendingImport, [invalidatePendingImport]);
  useEffect(() => () => revokeAssetUrls(ownedAssets.current), []);
  useEffect(
    () => () => {
      activeHtmlExport.current = null;
    },
    [],
  );

  const replaceAssets = useCallback((next: AssetUrls) => {
    const previous = ownedAssets.current;
    if (previous === next) return;
    // State updates can be batched without rendering intermediate asset maps.
    // Track ownership synchronously so even those maps are released.
    ownedAssets.current = next;
    setAssets(next);
    revokeAssetUrls(previous);
  }, []);

  const documentWriteLocked = view === 'markdown' || markdownDirty;
  const selection = useDocumentSelection(documentWriteLocked, setStatus);
  const {
    handleMathSelect,
    handleSelectionUpdate,
    refreshSelection,
    clearSelection,
  } = selection;
  const resolveImageUrl = useCallback(
    (source: string) => assets.get(source) ?? source,
    [assets],
  );
  const extensions = useMemo(
    () =>
      createEditorExtensions({
        onMathSelect: handleMathSelect,
        resolveImageUrl,
      }),
    [handleMathSelect, resolveImageUrl],
  );
  const editor = useEditor(
    {
      extensions,
      content: toEditorDocument(editorSource.document),
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'kumi-editor-content',
          'aria-label': copy.workspace.documentBody,
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        const content = updatedEditor.getJSON().content;
        if (!Array.isArray(content)) return;
        invalidatePendingImport();
        setDocument((current) => ({
          ...current,
          children: content as DocumentNode[],
        }));
        setDocumentDirty(true);
        refreshSelection(updatedEditor);
        setStatus({
          kind: 'idle',
          title: statusMessage('editing'),
          description: statusMessage('editingDescription'),
        });
      },
      onSelectionUpdate: ({ editor: updatedEditor }) =>
        handleSelectionUpdate(updatedEditor),
    },
    [editorSource.revision, extensions],
  );

  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.view.dom.setAttribute('aria-label', copy.workspace.documentBody);
  }, [copy.workspace.documentBody, editor]);

  const outline = useMemo(
    () =>
      [...walkDocumentTree(document.children)].filter(
        (
          node,
        ): node is
          | SemanticNode
          | Extract<DocumentNode, { type: 'codeBlock' }> =>
          isSemanticNode(node) || node.type === 'codeBlock',
      ),
    [document.children],
  );
  const analysis = useMemo(() => analyzeDocument(document), [document]);
  const selectedSemantic = outline.find(
    (node): node is SemanticNode =>
      isSemanticNode(node) &&
      node.attrs.nodeId === selection.selectedNode?.nodeId,
  );
  const displayedStatus = useMemo(
    () => ({
      kind: status.kind,
      title: statusMessageText(status.title, copy, locale),
      description: statusDescriptionText(status.description, copy, locale),
    }),
    [copy, locale, status],
  );

  const loadDocument = useCallback(
    (
      nextDocument: DocumentData,
      title: StatusMessage,
      options: LoadDocumentOptions = {},
    ) => {
      const next = migrateDocumentData(nextDocument);
      editor?.schema.nodeFromJSON(toEditorDocument(next));
      let serialized = '';
      let warning: StatusDescription | undefined;
      try {
        serialized = serializeDocument(next);
      } catch (error) {
        if (!(error instanceof MarkdownSerializationError)) throw error;
        warning = describeWorkspaceError(error, 'unableToSerialize');
      }

      invalidatePendingImport();
      if (options.assets !== undefined) replaceAssets(options.assets);
      setDocument(next);
      // A replaced source is a new editing session, so Undo cannot restore the previous file.
      setEditorSource((current) => ({
        revision: current.revision + 1,
        document: next,
      }));
      setMarkdownDraft(serialized);
      setMarkdownDirty(false);
      setDocumentDirty(false);
      clearSelection();
      setStatus({
        kind: 'success',
        title,
        description: combinedStatusDescription(options.description, warning),
      });
    },
    [clearSelection, editor, invalidatePendingImport, replaceAssets],
  );

  const importFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0 || documentWriteLocked) return;
      const request = ++importRevision.current;
      let pendingAssets: AssetUrls | undefined;
      try {
        const result = await readWorkspaceFiles(files);
        pendingAssets = result.assets;
        // A later import or edit wins, even if this file finishes reading last.
        if (request !== importRevision.current) return;
        const description: StatusMessage[] = result.diagnostics.map(
          diagnosticStatusMessage,
        );
        if (result.unresolved.length > 0)
          description.push(
            statusMessage('unresolvedImages', result.unresolved.join(', ')),
          );
        loadDocument(
          result.document,
          statusMessage(
            description.length > 0 ? 'loadedWithWarnings' : 'loaded',
            result.sourceName,
          ),
          { assets: result.assets, description },
        );
        pendingAssets = undefined;
      } catch (error) {
        if (request === importRevision.current)
          setStatus({
            kind: 'error',
            title: statusMessage('unableToLoadTitle'),
            description: describeWorkspaceError(error, 'unableToLoad'),
          });
      } finally {
        if (pendingAssets) revokeAssetUrls(pendingAssets);
      }
    },
    [documentWriteLocked, loadDocument],
  );

  const updateMarkdown = (source: string) => {
    invalidatePendingImport();
    setMarkdownDraft(source);
    setMarkdownDirty(true);
    setStatus({
      kind: 'idle',
      title: statusMessage('editingMarkdown'),
      description: statusMessage('editingMarkdownDescription'),
    });
  };

  const applyMarkdown = () => {
    invalidatePendingImport();
    try {
      const result = parseMarkdown(markdownDraft, {
        fallbackType: document.type,
      });
      loadDocument(result.document, statusMessage('appliedMarkdown'), {
        description: result.diagnostics.map(diagnosticStatusMessage),
      });
      setView('visual');
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage('unableToApplyMarkdown'),
        description: describeWorkspaceError(error, 'unableToParseMarkdown'),
      });
    }
  };

  const createDocument = (type: DocumentType) => {
    if (documentWriteLocked) return;
    loadDocument(
      createDefaultDocument(type),
      statusMessage(type === 'report' ? 'createdReport' : 'createdSlide'),
      { assets: new Map() },
    );
    setView('visual');
  };

  const changeView = (nextView: WorkspaceView) => {
    invalidatePendingImport();
    if (nextView === 'visual' && markdownDirty) {
      setStatus({
        kind: 'error',
        title: statusMessage('resolveMarkdownChanges'),
        description: statusMessage('resolveMarkdownChangesDescription'),
      });
      return;
    }
    if (nextView === 'markdown' && !markdownDirty) {
      try {
        setMarkdownDraft(serializeDocument(currentDocument(editor, document)));
      } catch (error) {
        setStatus({
          kind: 'error',
          title: statusMessage('unableToRefreshMarkdown'),
          description: describeWorkspaceError(error, 'unableToSerialize'),
        });
        return;
      }
    }
    setView(nextView);
  };

  const discardMarkdown = () => {
    invalidatePendingImport();
    try {
      setMarkdownDraft(serializeDocument(currentDocument(editor, document)));
      setMarkdownDirty(false);
      setView('visual');
      setStatus({ kind: 'idle', title: statusMessage('discardedMarkdown') });
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage('unableToDiscardMarkdown'),
        description: describeWorkspaceError(error, 'unableToSerialize'),
      });
    }
  };

  const saveDocument = (format: DocumentFileFormat) => {
    invalidatePendingImport();
    const json = format === 'json';
    try {
      const result = markdownDirty
        ? parseMarkdown(markdownDraft, { fallbackType: document.type })
        : { document: currentDocument(editor, document), diagnostics: [] };
      downloadDocument(result.document, format);
      if (markdownDirty) {
        loadDocument(
          result.document,
          statusMessage(
            json ? 'savedJsonAfterApplying' : 'savedMarkdownAfterApplying',
          ),
          {
            description: result.diagnostics.map(diagnosticStatusMessage),
          },
        );
      } else {
        setDocumentDirty(false);
        setStatus({
          kind: 'success',
          title: statusMessage(json ? 'savedJson' : 'savedMarkdown'),
        });
      }
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage(
          json ? 'unableToSaveJson' : 'unableToSaveMarkdown',
        ),
        description: describeWorkspaceError(
          error,
          json ? 'invalidDocumentData' : 'unableToSerialize',
        ),
      });
    }
  };

  const exportHtml = async () => {
    if (activeHtmlExport.current !== null) return;
    const revision = ++importRevision.current;
    activeHtmlExport.current = revision;
    setHtmlExporting(true);
    try {
      const snapshot = markdownDirty
        ? parseMarkdown(markdownDraft, { fallbackType: document.type })
        : { document: currentDocument(editor, document), diagnostics: [] };
      if (snapshot.document.type !== 'slide')
        throw new WorkspaceStatusError(statusMessage('htmlSlidesOnly'));
      setStatus({ kind: 'idle', title: statusMessage('exportingHtml') });
      // Load the static renderer and embedded fonts only when export is requested.
      const { exportSlideHtml } = await import('@/src/export/slide-html');
      if (revision !== importRevision.current) return;
      const result = await exportSlideHtml(snapshot.document, assets, locale);
      if (revision !== importRevision.current) return;
      downloadFile(
        snapshot.document,
        'html',
        result.html,
        'text/html;charset=utf-8',
      );
      setStatus({
        kind: 'success',
        title: statusMessage('exportedHtml'),
        description: [
          ...snapshot.diagnostics.map(diagnosticStatusMessage),
          statusMessage('htmlExportDescription'),
          ...(result.externalImages.length > 0
            ? [statusMessage('htmlExternalImages')]
            : []),
        ],
      });
      // Viewing output is not an editable-source save: preserve drafts, Undo and dirty flags.
    } catch (error) {
      if (revision === importRevision.current)
        setStatus({
          kind: 'error',
          title: statusMessage('unableToExportHtml'),
          description: describeWorkspaceError(error, 'unableToExportHtml'),
        });
    } finally {
      if (activeHtmlExport.current === revision) {
        activeHtmlExport.current = null;
        setHtmlExporting(false);
        if (revision !== importRevision.current) {
          setStatus((current) =>
            typeof current.title === 'object' &&
            'key' in current.title &&
            current.title.key === 'exportingHtml'
              ? { kind: 'idle', title: statusMessage('htmlExportCancelled') }
              : current,
          );
        }
      }
    }
  };

  const updateTheme = (theme: string) => {
    if (documentWriteLocked) return;
    invalidatePendingImport();
    setDocument((current) => ({
      ...current,
      metadata: { ...current.metadata, theme },
    }));
    setDocumentDirty(true);
  };

  const updateDocumentFlag = (key: DocumentFlag, checked: boolean) => {
    if (documentWriteLocked) return;
    invalidatePendingImport();
    setDocument((current) => ({
      ...current,
      metadata: { ...current.metadata, [key]: checked },
    }));
    setDocumentDirty(true);
  };

  return {
    document,
    editor,
    view,
    markdownDraft,
    documentWriteLocked,
    displayedStatus,
    dirty: documentDirty || markdownDirty,
    outline,
    analysis,
    selectedSemantic,
    selectedNode: selection.selectedNode,
    mathDraft: selection.mathDraft,
    setMathDraft: selection.setMathDraft,
    focusNode: (nodeId: string) => selection.focusNode(editor, nodeId),
    applyMath: () => selection.applyMath(editor),
    applyAttributes: (nodeId: string, attrs: Record<string, unknown>) =>
      selection.applyAttributes(editor, nodeId, attrs),
    resolveImageUrl,
    importFiles,
    updateMarkdown,
    applyMarkdown,
    createDocument,
    changeView,
    discardMarkdown,
    saveDocument,
    exportHtml,
    htmlExporting,
    updateTheme,
    updateDocumentFlag,
  };
}
