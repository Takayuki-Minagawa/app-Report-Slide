'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import { useAppPreferences } from '@/components/app-preferences';
import {
  createDefaultDocument,
  createNodeId,
  toEditorDocument,
  type DocumentData,
  type DocumentMetadata,
  type DocumentNode,
  type DocumentType,
  type FigureNode,
} from '@/src/document/model';
import {
  pageSettingsSchema,
  type PageSettings,
} from '@/src/document/page-settings';
import type { DocumentFlag } from '@/src/document/metadata';
import { migrateDocumentData } from '@/src/document/validation';
import {
  analyzeDocument,
  isSemanticNode,
  type SemanticNode,
} from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import { referencedAssets } from '@/src/document/assets';
import { officeFeatureWarnings } from '@/src/export/format-capabilities';
import { createFigureAuthoringSample } from '@/src/workspace/figure-authoring-sample';
import {
  figureEditSchema,
  figureReferences,
  figureReferencesSchema,
} from '@/src/document/figure-edit';
import { updateDocumentNode } from '@/src/editor/document-commands';
import {
  insertDocumentBlock,
  insertionPage,
} from '@/src/editor/block-commands';
import type { PdfFigureImport } from './pdf-import-dialog';
import {
  extractionBlocks,
  extractionResultSchema,
} from '@/src/document/extraction';
import { createEditorExtensions } from '@/src/editor/extensions';
import { defaultSlideImagePlacement } from '@/src/document/slide-layout';
import { parseMarkdown, type ParseMarkdownResult } from '@/src/markdown/parser';
import {
  serializeDocument,
  MarkdownSerializationError,
} from '@/src/markdown/serializer';
import {
  cloneDocument,
  initialDocument,
  initialMarkdown,
  sampleReportDocument,
  sampleSlideDocument,
} from '@/src/workspace/initial-document';
import {
  assetByteTotal,
  createInsertedImageAsset,
  createInsertedPdfAsset,
  readWorkspaceFiles,
  revokeAssetUrls,
  downloadDocument,
  downloadFile,
  type AssetUrls,
  type DocumentFileFormat,
  type ImportedDocument,
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
import {
  captureRecoveryAssets,
  clearWorkspaceRecovery,
  nextRecoveryTimestamp,
  prepareWorkspaceRecoveries,
  removeWorkspaceRecovery,
  restoreRecoveryAssets,
  writeWorkspaceRecovery,
  type WorkspaceRecovery,
} from '@/src/workspace/recovery';
import { useDocumentSelection } from './use-document-selection';
import {
  useProjectActions,
  projectWithDocument,
  type ProjectSession,
} from './use-project-actions';
import {
  assembleReportProject,
  isLocalProjectImage,
  resolveProjectPath,
  validateReportProject,
  ReportProjectError,
  projectDocumentType,
  projectChapterDocument,
} from '@/src/project/model';
import { chapterLocalAssets } from '@/src/project/assets';
import { assignBlockRegion } from '@/src/document/block-groups';
import type { SlideRegion } from '@/src/document/slide-design';
import { splitDocumentPages } from '@/src/document/semantics';
import { isHistoryTransaction } from '@tiptap/pm/history';

export type WorkspaceView = 'visual' | 'layout' | 'markdown' | 'preview';

interface LoadDocumentOptions {
  assets?: AssetUrls;
  description?: StatusDescription;
  projectAssets?: boolean;
  focusNodeId?: string;
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

function imageSources(
  nodes: readonly DocumentNode[],
  metadata: DocumentMetadata = {},
): Set<string> {
  return new Set(referencedAssets(nodes, metadata).map(({ source }) => source));
}

function pdfFigureAssets(nodes: readonly DocumentNode[]): Set<string> {
  const sources = new Set<string>();
  for (const node of walkDocumentTree(nodes)) {
    if (node.type !== 'figure' || !node.attrs.figureEdit?.pdfSource) continue;
    sources.add(node.attrs.src);
    sources.add(node.attrs.figureEdit.pdfSource.asset);
  }
  return sources;
}

function retainedAssetsForSources(
  assets: AssetUrls,
  sources: ReadonlySet<string>,
): AssetUrls {
  const retained = new Map(
    [...assets].filter(([source]) => sources.has(source)),
  );
  return retained.size === assets.size ? assets : retained;
}

class ImageAssetStore {
  private assetUrls: AssetUrls = new Map();

  get assets(): AssetUrls {
    return this.assetUrls;
  }

  get bytes(): number {
    return assetByteTotal(this.assetUrls);
  }

  replace(next: AssetUrls): AssetUrls {
    const previous = this.assetUrls;
    this.assetUrls = next;
    return previous;
  }
}

function insertionPositionForSlide(editor: Editor, slideIndex: number): number {
  let currentSlide = 0;
  let insertion = editor.state.doc.content.size;
  let found = false;
  editor.state.doc.descendants((node, position) => {
    if (found) return false;
    if (node.type.name !== 'slideBreak' && node.type.name !== 'pageBreak')
      return true;
    if (currentSlide === slideIndex) {
      insertion = position;
      found = true;
      return false;
    }
    currentSlide += 1;
    return true;
  });
  return insertion;
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
  const [projectSession, setProjectSession] = useState<ProjectSession | null>(
    null,
  );
  const [exportScope, setExportScope] = useState<'project' | 'chapter'>(
    'project',
  );
  const pendingFocus = useRef<string | null>(null);
  const [documentUndo, setDocumentUndo] = useState<{
    document: DocumentData;
    after: string;
    chapterId?: string;
    projectSignature: string;
  } | null>(null);
  const [insertionRegion, setRegion] = useState<SlideRegion | undefined>();
  const insertionRegionRef = useRef<SlideRegion | undefined>(undefined);
  const setInsertionRegion = (region: SlideRegion | undefined) => {
    insertionRegionRef.current = region;
    setRegion(region);
  };
  const markProjectEdited = useCallback(() => {
    setProjectSession((current) =>
      current && !current.dirty ? { ...current, dirty: true } : current,
    );
  }, []);
  const [markdownDirty, setMarkdownDirty] = useState(false);
  const [assetStore] = useState(() => new ImageAssetStore());
  const [assets, setAssets] = useState<AssetUrls>(() => assetStore.assets);
  // PDF edits can replace rendered pages. Keep those blobs until the editor history is replaced.
  const pdfHistoryAssets = useRef(pdfFigureAssets(initialDocument.children));
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    WorkspaceRecovery[]
  >([]);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const pendingRecovery = recoveryCandidates[0] ?? null;
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryRestoring, setRecoveryRestoring] = useState(false);
  const [recoverySavedSignature, setRecoverySavedSignature] = useState<
    string | null
  >(null);
  const [lastHtmlExportSignature, setLastHtmlExportSignature] = useState<
    string | null
  >(null);
  const recoveryQueue = useRef<Promise<void>>(Promise.resolve());
  const recoveryRevision = useRef(0);
  const recoveryFailureReported = useRef(false);
  const [htmlExporting, setHtmlExporting] = useState(false);
  const activeHtmlExport = useRef<number | null>(null);
  const [binaryExporting, setBinaryExporting] = useState<
    'office' | 'pdf' | null
  >(null);
  const activeBinaryExport = useRef<number | null>(null);
  const importRevision = useRef(0);
  const [pendingHtmlImport, setPendingHtmlImport] =
    useState<ImportedDocument | null>(null);
  const pendingHtmlRef = useRef<{
    result: ImportedDocument;
    revision: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (pendingHtmlRef.current)
        revokeAssetUrls(pendingHtmlRef.current.result.assets);
    },
    [],
  );
  const invalidatePendingImport = useCallback(() => {
    importRevision.current++;
  }, []);
  useEffect(() => invalidatePendingImport, [invalidatePendingImport]);
  useEffect(() => () => revokeAssetUrls(assetStore.assets), [assetStore]);
  useEffect(
    () => () => {
      activeHtmlExport.current = null;
      activeBinaryExport.current = null;
    },
    [],
  );

  const replaceAssets = useCallback(
    (next: AssetUrls) => {
      const previous = assetStore.replace(next);
      if (previous === next) return;
      // State updates can be batched without rendering intermediate asset maps.
      // Track ownership synchronously so even those maps are released.
      setAssets(next);
      const retained = new Set(next.values());
      revokeAssetUrls(
        new Map([...previous].filter(([, url]) => !retained.has(url))),
      );
    },
    [assetStore],
  );

  const pruneUnusedSlideAssets = useCallback(
    (nodes: readonly DocumentNode[]) =>
      replaceAssets(
        retainedAssetsForSources(
          assetStore.assets,
          new Set([
            ...imageSources(nodes, document.metadata),
            ...pdfHistoryAssets.current,
          ]),
        ),
      ),
    [assetStore, replaceAssets, document.metadata],
  );

  const enqueueRecoveryTask = useCallback((task: () => Promise<void>) => {
    const queued = recoveryQueue.current.then(task, task);
    recoveryQueue.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const clearRecovery = useCallback(async () => {
    recoveryRevision.current++;
    try {
      await enqueueRecoveryTask(clearWorkspaceRecovery);
    } catch {
      // A stale recovery copy is never allowed to block editing or exports.
    }
  }, [enqueueRecoveryTask]);

  const documentWriteLocked = view === 'markdown' || markdownDirty;
  const selection = useDocumentSelection(
    documentWriteLocked,
    document.type,
    setStatus,
  );
  const {
    handleMathSelect,
    handleSelectionUpdate,
    refreshSelection,
    clearSelection,
  } = selection;
  const chapterFile = projectSession?.project.chapters.find(
    (chapter) => chapter.id === projectSession.activeChapterId,
  )?.file;
  const resolveImageUrl = useCallback(
    (source: string) => {
      let path = source;
      if (chapterFile && isLocalProjectImage(source)) {
        try {
          path = resolveProjectPath(chapterFile, source);
        } catch {
          return source;
        }
      }
      return assetStore.assets.get(path) ?? source;
    },
    [assetStore, chapterFile],
  );
  const resolvePreviewImageUrl = useCallback(
    (source: string) => assetStore.assets.get(source) ?? source,
    [assetStore],
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
      onUpdate: ({ editor: updatedEditor, transaction }) => {
        const content = updatedEditor.getJSON().content;
        if (!Array.isArray(content)) return;
        invalidatePendingImport();
        const children = content as DocumentNode[];
        if (document.type === 'slide' && !projectSession)
          pruneUnusedSlideAssets(children);
        const beforeIds = new Set<string>();
        transaction.before.forEach((node) => {
          if (node.attrs.nodeId) beforeIds.add(node.attrs.nodeId);
        });
        const inserted = children
          .filter(
            (node) =>
              !beforeIds.has(node.attrs.nodeId) &&
              (node.type === 'table' ||
                node.type === 'chart' ||
                (node.type === 'figure' && !node.attrs.slidePlacement)),
          )
          .map((node) => node.attrs.nodeId);
        const region =
          !isHistoryTransaction(transaction) && inserted.length
            ? insertionRegionRef.current
            : undefined;
        if (region) setInsertionRegion(undefined);
        setDocument((current) => {
          let next = { ...current, children };
          if (region && current.type === 'slide')
            splitDocumentPages(next).forEach((nodes, pageIndex) => {
              const ids = inserted.filter((id) =>
                nodes.some((node) => node.attrs.nodeId === id),
              );
              if (ids.length)
                next = assignBlockRegion(next, pageIndex, ids, region);
            });
          return next;
        });
        setDocumentDirty(true);
        markProjectEdited();
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
  useEffect(() => {
    if (!pendingFocus.current || !editor || editor.isDestroyed) return;
    selection.focusNode(editor, pendingFocus.current);
    pendingFocus.current = null;
  }, [editor, selection]);

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
  const project = useMemo(
    () =>
      projectSession ? projectWithDocument(projectSession, document) : null,
    [projectSession, document],
  );
  const previewDocument = useMemo(
    () => (project ? assembleReportProject(project) : document),
    [project, document],
  );
  const localPreviewDocument = useMemo(() => {
    const chapter = project?.chapters.find(
      (entry) => entry.id === projectSession?.activeChapterId,
    );
    return project && chapter
      ? projectChapterDocument(project, chapter)
      : document;
  }, [project, projectSession?.activeChapterId, document]);
  const localAnalysis = useMemo(
    () => analyzeDocument(localPreviewDocument),
    [localPreviewDocument],
  );
  const analysis = useMemo(
    () => analyzeDocument(previewDocument),
    [previewDocument],
  );
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
      pdfHistoryAssets.current = pdfFigureAssets(next.children);
      const sourceAssets = options.assets ?? assetStore.assets;
      if (next.type === 'slide' && !options.projectAssets) {
        replaceAssets(
          retainedAssetsForSources(
            sourceAssets,
            imageSources(next.children, next.metadata),
          ),
        );
      } else if (options.assets !== undefined) {
        replaceAssets(sourceAssets);
      }
      setDocument(next);
      pendingFocus.current = options.focusNodeId ?? null;
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
    [
      assetStore.assets,
      clearSelection,
      editor,
      invalidatePendingImport,
      replaceAssets,
    ],
  );

  const hasUnsavedChanges =
    documentDirty || markdownDirty || Boolean(projectSession?.dirty);
  const confirmReplacement = useCallback(
    () =>
      !hasUnsavedChanges || window.confirm(copy.workspace.replaceConfirmation),
    [copy.workspace.replaceConfirmation, hasUnsavedChanges],
  );
  const projectActions = useProjectActions({
    session: projectSession,
    setSession: setProjectSession,
    getDocument: () => currentDocument(editor, document),
    loadDocument,
    assets,
    getRevision: () => importRevision.current,
    nextRevision: () => ++importRevision.current,
    locked: documentWriteLocked,
    setStatus,
    showEditor: () => setView('visual'),
    markDocumentSaved: () => {
      setDocumentDirty(false);
      void clearRecovery();
    },
    clearRecovery,
    confirmReplacement,
    copy: copy.project,
    focusNode: (nodeId) => selection.focusNode(editor, nodeId),
  });
  const validateChapterDraft = (next: DocumentData) => {
    if (!projectSession) return;
    if (next.type !== projectDocumentType(projectSession.project))
      throw new ReportProjectError('reportOnly');
    validateReportProject(projectWithDocument(projectSession, next));
  };

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  const reportRecoveryFailure = useCallback(() => {
    if (recoveryFailureReported.current) return;
    recoveryFailureReported.current = true;
    setStatus({
      kind: 'error',
      title: statusMessage('recoveryUnavailable'),
    });
  }, []);

  useEffect(() => {
    let active = true;
    void enqueueRecoveryTask(async () => {
      const candidates = await prepareWorkspaceRecoveries();
      if (!active) return;
      setRecoveryCandidates(candidates);
      setRecoveryReady(true);
    }).catch(() => {
      if (!active) return;
      reportRecoveryFailure();
      setRecoveryReady(true);
    });
    return () => {
      active = false;
    };
  }, [enqueueRecoveryTask, reportRecoveryFailure]);

  const workspaceSignature = useMemo(
    () =>
      JSON.stringify([document, markdownDraft, markdownDirty, projectSession]),
    [document, markdownDraft, markdownDirty, projectSession],
  );

  const saveRecovery = useCallback(async () => {
    const revision = ++recoveryRevision.current;
    const savedAt = nextRecoveryTimestamp();
    const current = currentDocument(editor, document);
    const currentProject = projectSession
      ? projectWithDocument(projectSession, current)
      : undefined;
    let recoveryAssets;
    try {
      recoveryAssets = await captureRecoveryAssets(assets);
    } catch {
      reportRecoveryFailure();
      return;
    }
    if (revision !== recoveryRevision.current) return;

    const recovery: WorkspaceRecovery = {
      schemaVersion: 1,
      savedAt,
      document: current,
      markdownDraft,
      markdownDirty,
      view,
      ...(currentProject
        ? {
            project: {
              project: currentProject,
              activeChapterId: projectSession!.activeChapterId,
            },
          }
        : {}),
      assets: recoveryAssets,
    };
    try {
      await enqueueRecoveryTask(async () => {
        if (revision !== recoveryRevision.current) return;
        const saved = await writeWorkspaceRecovery(recovery);
        if (revision === recoveryRevision.current)
          setRecoverySavedSignature(saved ? workspaceSignature : null);
      });
    } catch {
      reportRecoveryFailure();
    }
  }, [
    assets,
    document,
    editor,
    enqueueRecoveryTask,
    markdownDirty,
    markdownDraft,
    projectSession,
    reportRecoveryFailure,
    workspaceSignature,
    view,
  ]);

  useEffect(() => {
    if (!recoveryReady || !hasUnsavedChanges) return;
    const timeout = window.setTimeout(() => {
      void saveRecovery();
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [hasUnsavedChanges, recoveryReady, saveRecovery]);

  useEffect(() => {
    if (!recoveryReady || !hasUnsavedChanges) return;
    const saveWhenHidden = () => {
      if (window.document.visibilityState === 'hidden') void saveRecovery();
    };
    window.document.addEventListener('visibilitychange', saveWhenHidden);
    return () =>
      window.document.removeEventListener('visibilitychange', saveWhenHidden);
  }, [hasUnsavedChanges, recoveryReady, saveRecovery]);

  const discardRecovery = async () => {
    if (!pendingRecovery || recoveryRestoring) return;
    setRecoveryRestoring(true);
    try {
      await enqueueRecoveryTask(() =>
        removeWorkspaceRecovery(pendingRecovery.savedAt),
      );
      setRecoveryCandidates((current) =>
        current.filter((item) => item.savedAt !== pendingRecovery.savedAt),
      );
    } catch {
      reportRecoveryFailure();
    } finally {
      setRecoveryRestoring(false);
    }
  };

  const restoreRecovery = async () => {
    if (
      !pendingRecovery ||
      !editor ||
      recoveryRestoring ||
      !confirmReplacement()
    )
      return;
    setRecoveryRestoring(true);
    let restoredAssets: AssetUrls | undefined;
    try {
      let restoredDocument = migrateDocumentData(pendingRecovery.document);
      let restoredProject: ProjectSession | null = null;
      if (pendingRecovery.project) {
        const project = validateReportProject(pendingRecovery.project.project);
        const chapter = project.chapters.find(
          (candidate) =>
            candidate.id === pendingRecovery.project!.activeChapterId,
        );
        if (!chapter) throw new ReportProjectError('invalidArchive');
        restoredDocument = chapter.document;
        restoredProject = {
          project,
          activeChapterId: chapter.id,
          dirty: true,
        };
      }
      editor.schema.nodeFromJSON(toEditorDocument(restoredDocument));
      restoredAssets = restoreRecoveryAssets(pendingRecovery.assets);
      invalidatePendingImport();
      pdfHistoryAssets.current = pdfFigureAssets(restoredDocument.children);
      replaceAssets(restoredAssets);
      restoredAssets = undefined;
      setDocument(restoredDocument);
      setEditorSource((current) => ({
        revision: current.revision + 1,
        document: restoredDocument,
      }));
      setMarkdownDraft(pendingRecovery.markdownDraft);
      setMarkdownDirty(pendingRecovery.markdownDirty);
      setDocumentDirty(true);
      setProjectSession(restoredProject);
      setView(
        pendingRecovery.markdownDirty
          ? 'markdown'
          : pendingRecovery.view === 'layout' &&
              restoredDocument.type !== 'slide'
            ? 'visual'
            : pendingRecovery.view,
      );
      clearSelection();
      setStatus({ kind: 'success', title: statusMessage('recoveredDraft') });
      // Keep the durable source until explicit deletion. The restored document's
      // next autosave is debounced and may fail or never run before the tab closes.
      setRecoveryOpen(false);
      setRecoveryReady(true);
    } catch (error) {
      if (restoredAssets) revokeAssetUrls(restoredAssets);
      setStatus({
        kind: 'error',
        title: statusMessage('unableToRecover'),
        description: describeWorkspaceError(error, 'invalidDocumentData'),
      });
    } finally {
      setRecoveryRestoring(false);
    }
  };

  const insertSlideImage = useCallback(
    (file: File, slideIndex: number) => {
      if (
        !editor ||
        document.type !== 'slide' ||
        documentWriteLocked ||
        markdownDirty
      )
        return;
      let asset: { source: string; url: string } | undefined;
      let previousAssets: AssetUrls | undefined;
      let assetRegistered = false;
      try {
        const currentAssets = assetStore.assets;
        previousAssets = currentAssets;
        asset = createInsertedImageAsset(
          file,
          currentAssets,
          imageSources(
            currentDocument(editor, document).children,
            document.metadata,
          ),
          assetStore.bytes,
          (source) =>
            chapterFile ? resolveProjectPath(chapterFile, source) : source,
        );
        // The editor renders synchronously. Register the blob first so its
        // figure extension resolves the local source during insertion.
        replaceAssets(
          new Map([
            ...currentAssets,
            [
              chapterFile
                ? resolveProjectPath(chapterFile, asset.source)
                : asset.source,
              asset.url,
            ],
          ]),
        );
        assetRegistered = true;
        const inserted = editor
          .chain()
          .focus()
          .insertContentAt(insertionPositionForSlide(editor, slideIndex), {
            type: 'figure',
            attrs: {
              src: asset.source,
              alt: file.name.replace(/\.[^.]+$/, ''),
              title: null,
              width: 100,
              align: 'center',
              slidePlacement: { ...defaultSlideImagePlacement },
            },
          })
          .run();
        if (!inserted)
          throw new WorkspaceStatusError(statusMessage('unableToInsertImage'));
        asset = undefined;
        setStatus({ kind: 'success', title: statusMessage('imageInserted') });
      } catch (error) {
        if (assetRegistered && previousAssets) replaceAssets(previousAssets);
        else if (asset) revokeAssetUrls(new Map([[asset.source, asset.url]]));
        setStatus({
          kind: 'error',
          title: statusMessage('unableToInsertImage'),
          description: describeWorkspaceError(error, 'unableToLoad'),
        });
      }
    },
    [
      assetStore,
      document,
      documentWriteLocked,
      editor,
      markdownDirty,
      replaceAssets,
      chapterFile,
    ],
  );
  const importFiles = useCallback(
    async (files: readonly File[]) => {
      if (files.length === 0 || documentWriteLocked || !confirmReplacement())
        return;
      const request = ++importRevision.current;
      let pendingAssets: AssetUrls | undefined;
      try {
        const result = await readWorkspaceFiles(files);
        pendingAssets = result.assets;
        // A later import or edit wins, even if this file finishes reading last.
        if (request !== importRevision.current) return;
        if (result.htmlImport) {
          if (pendingHtmlRef.current)
            revokeAssetUrls(pendingHtmlRef.current.result.assets);
          pendingHtmlRef.current = { result, revision: request };
          setPendingHtmlImport(result);
          pendingAssets = undefined;
          return;
        }
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
        setProjectSession(null);
        void clearRecovery();
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
    [clearRecovery, documentWriteLocked, loadDocument, confirmReplacement],
  );

  const cancelHtmlImport = () => {
    if (pendingHtmlRef.current)
      revokeAssetUrls(pendingHtmlRef.current.result.assets);
    pendingHtmlRef.current = null;
    setPendingHtmlImport(null);
  };

  const confirmHtmlImport = () => {
    const pending = pendingHtmlRef.current;
    if (!pending) return;
    if (pending.revision !== importRevision.current) {
      cancelHtmlImport();
      setStatus({
        kind: 'error',
        title:
          locale === 'ja'
            ? '確認中に文書が変更されました。HTMLを開き直してください。'
            : 'The document changed during preview. Open the HTML again.',
      });
      return;
    }
    if (!confirmReplacement()) return;
    try {
      const result = pending.result;
      loadDocument(
        result.document,
        statusMessage('loaded', result.sourceName),
        {
          assets: result.assets,
          description: [
            ...(result.htmlImport?.warnings ?? []),
            ...result.diagnostics.map(diagnosticStatusMessage),
            ...(result.unresolved.length
              ? [
                  statusMessage(
                    'unresolvedImages',
                    result.unresolved.join(', '),
                  ),
                ]
              : []),
          ],
        },
      );
      pendingHtmlRef.current = null;
      setPendingHtmlImport(null);
      setProjectSession(null);
      setView('visual');
      void clearRecovery();
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage('unableToLoadTitle'),
        description: describeWorkspaceError(error, 'unableToLoad'),
      });
    }
  };

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
      validateChapterDraft(result.document);
      markProjectEdited();
      loadDocument(result.document, statusMessage('appliedMarkdown'), {
        description: result.diagnostics.map(diagnosticStatusMessage),
        projectAssets: Boolean(projectSession),
      });
      setDocumentDirty(true);
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
    if (documentWriteLocked || !confirmReplacement()) return;
    loadDocument(
      createDefaultDocument(type),
      statusMessage(type === 'report' ? 'createdReport' : 'createdSlide'),
      { assets: new Map() },
    );
    setProjectSession(null);
    void clearRecovery();
    setView('visual');
  };

  const loadSample = (type: DocumentType | 'figures') => {
    if (documentWriteLocked || !confirmReplacement()) return;
    loadDocument(
      cloneDocument(
        type === 'figures'
          ? createFigureAuthoringSample()
          : type === 'report'
            ? sampleReportDocument
            : sampleSlideDocument,
      ),
      locale === 'ja' ? 'サンプルを開きました' : 'Example opened',
      { assets: new Map() },
    );
    setProjectSession(null);
    void clearRecovery();
    setView('visual');
  };

  const changeView = (nextView: WorkspaceView) => {
    invalidatePendingImport();
    if (nextView === 'layout' && document.type !== 'slide') return;
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
      if (!projectSession?.dirty) void clearRecovery();
      setStatus({ kind: 'idle', title: statusMessage('discardedMarkdown') });
    } catch (error) {
      setStatus({
        kind: 'error',
        title: statusMessage('unableToDiscardMarkdown'),
        description: describeWorkspaceError(error, 'unableToSerialize'),
      });
    }
  };

  /** The document a save or export acts on: an unapplied Markdown draft wins. */
  const snapshotDocument = (): Pick<
    ParseMarkdownResult,
    'document' | 'diagnostics'
  > =>
    markdownDirty
      ? parseMarkdown(markdownDraft, { fallbackType: document.type })
      : { document: currentDocument(editor, document), diagnostics: [] };

  /** Shared by file export and output preview, with local asset keys for chapter-only exports. */
  const getExportSnapshot = () => {
    const snapshot = snapshotDocument();
    validateChapterDraft(snapshot.document);
    if (!projectSession) return { ...snapshot, assets: assetStore.assets };
    const project = projectWithDocument(projectSession, snapshot.document);
    if (exportScope === 'project')
      return {
        document: migrateDocumentData(assembleReportProject(project)),
        diagnostics: snapshot.diagnostics,
        assets: assetStore.assets,
      };
    const chapter = project.chapters.find(
      (entry) => entry.id === projectSession.activeChapterId,
    )!;
    return {
      document: projectChapterDocument(project, chapter),
      diagnostics: snapshot.diagnostics,
      assets: chapterLocalAssets(chapter, assetStore.assets),
    };
  };

  /** A saved draft becomes the edited document; otherwise only the dirty flag clears. */
  const finishSave = (
    snapshot: Pick<ParseMarkdownResult, 'document' | 'diagnostics'>,
    saved: StatusMessage,
    savedAfterApplying: StatusMessage,
  ) => {
    if (markdownDirty) {
      markProjectEdited();
      loadDocument(snapshot.document, savedAfterApplying, {
        description: snapshot.diagnostics.map(diagnosticStatusMessage),
        projectAssets: Boolean(projectSession),
      });
    } else {
      setDocumentDirty(false);
      setStatus({ kind: 'success', title: saved });
    }
    if (!projectSession) void clearRecovery();
  };

  const saveDocument = (format: DocumentFileFormat) => {
    invalidatePendingImport();
    const json = format === 'json';
    try {
      const result = snapshotDocument();
      validateChapterDraft(result.document);
      const currentProject = projectSession
        ? projectWithDocument(projectSession, result.document)
        : null;
      const chapter = currentProject?.chapters.find(
        (entry) => entry.id === projectSession?.activeChapterId,
      );
      downloadDocument(
        currentProject && chapter
          ? projectChapterDocument(currentProject, chapter)
          : result.document,
        format,
      );
      finishSave(
        result,
        statusMessage(json ? 'savedJson' : 'savedMarkdown'),
        statusMessage(
          json ? 'savedJsonAfterApplying' : 'savedMarkdownAfterApplying',
        ),
      );
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

  const saveArchive = async () => {
    const revision = ++importRevision.current;
    try {
      const snapshot = getExportSnapshot();
      validateChapterDraft(snapshot.document);
      const { writeDocumentArchive } =
        await import('@/src/workspace/document-archive');
      const content = await writeDocumentArchive(
        snapshot.document,
        snapshot.assets,
      );
      if (revision !== importRevision.current) return;
      downloadFile(
        snapshot.document,
        'zip',
        new Uint8Array(content),
        'application/zip',
      );
      if (projectSession)
        setStatus({ kind: 'success', title: statusMessage('savedArchive') });
      else
        finishSave(
          snapshot,
          statusMessage('savedArchive'),
          statusMessage('savedArchive'),
        );
    } catch (error) {
      if (revision === importRevision.current)
        setStatus({
          kind: 'error',
          title: statusMessage('unableToSaveArchive'),
          description: describeWorkspaceError(error, 'unableToSaveJson'),
        });
    }
  };

  const exportHtml = async () => {
    if (
      activeHtmlExport.current !== null ||
      activeBinaryExport.current !== null
    )
      return;
    const revision = ++importRevision.current;
    activeHtmlExport.current = revision;
    setHtmlExporting(true);
    try {
      const snapshot = getExportSnapshot();
      setStatus({ kind: 'idle', title: statusMessage('exportingHtml') });
      // Load the static renderer and embedded fonts only when export is requested.
      const source = snapshot.document;
      const result =
        source.type === 'slide'
          ? await (
              await import('@/src/export/slide-html')
            ).exportSlideHtml(source, snapshot.assets, locale)
          : await (
              await import('@/src/export/report-html')
            ).exportReportHtml(source, snapshot.assets, locale);
      if (revision !== importRevision.current) return;
      downloadFile(source, 'html', result.html, 'text/html;charset=utf-8');
      setLastHtmlExportSignature(workspaceSignature);
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
      // A browser download cannot confirm disk persistence; keep drafts, Undo and recovery copies.
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

  const exportBinary = async (format: 'office' | 'pdf') => {
    if (
      activeBinaryExport.current !== null ||
      activeHtmlExport.current !== null
    )
      return;
    const revision = ++importRevision.current;
    activeBinaryExport.current = revision;
    setBinaryExporting(format);
    let label =
      format === 'pdf'
        ? 'PDF'
        : document.type === 'slide'
          ? 'PowerPoint'
          : 'Word';
    try {
      const snapshot = getExportSnapshot();
      validateChapterDraft(snapshot.document);
      const source = snapshot.document;
      const extension =
        format === 'pdf' ? 'pdf' : source.type === 'slide' ? 'pptx' : 'docx';
      label =
        extension === 'pdf'
          ? 'PDF'
          : extension === 'pptx'
            ? 'PowerPoint'
            : 'Word';
      setStatus({ kind: 'idle', title: statusMessage('exportingFile', label) });
      const result =
        format === 'pdf'
          ? await (
              await import('@/src/export/document-pdf')
            ).exportDocumentPdf(source, snapshot.assets, locale)
          : source.type === 'slide'
            ? await (
                await import('@/src/export/slide-pptx')
              ).exportSlidePptx(source, snapshot.assets, locale)
            : await (
                await import('@/src/export/report-docx')
              ).exportReportDocx(source, snapshot.assets, locale);
      if (revision !== importRevision.current) return;
      const mime =
        extension === 'pdf'
          ? 'application/pdf'
          : extension === 'pptx'
            ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      downloadFile(source, extension, result.blob, mime);
      setStatus({
        kind: 'success',
        title: statusMessage('exportedFile', label),
        description: [
          ...snapshot.diagnostics.map(diagnosticStatusMessage),
          statusMessage('binaryExportDescription'),
          ...(format === 'office' ? officeFeatureWarnings(source, locale) : []),
          ...(format === 'office' &&
          source.type === 'slide' &&
          source.metadata.slide_design
            ? [
                locale === 'ja'
                  ? 'スライドの新しい配置・役割別文字設定はHTMLとPDFに対応しています。PPTXは独自の組版で出力するため、見た目を確認してください。'
                  : 'The new slide layouts and role typography apply to HTML and PDF. PPTX uses its own layout; review the appearance.',
              ]
            : []),
          ...result.warnings,
        ],
      });
    } catch (error) {
      if (revision === importRevision.current)
        setStatus({
          kind: 'error',
          title: statusMessage('unableToExportFile', label),
          description: describeWorkspaceError(error, 'invalidDocumentData'),
        });
    } finally {
      if (activeBinaryExport.current === revision) {
        activeBinaryExport.current = null;
        setBinaryExporting(null);
        if (revision !== importRevision.current)
          setStatus((current) =>
            typeof current.title === 'object' &&
            'key' in current.title &&
            current.title.key === 'exportingFile'
              ? { kind: 'idle', title: statusMessage('binaryExportCancelled') }
              : current,
          );
      }
    }
  };

  /** Document settings are outside Undo; a project keeps them in its manifest. */
  const updateMetadata = (updates: DocumentMetadata) => {
    if (documentWriteLocked) return;
    if (projectSession) {
      if (updates.figure_references !== undefined) {
        setDocument((current) => ({
          ...current,
          metadata: {
            ...current.metadata,
            figure_references: updates.figure_references,
          },
        }));
      }
      projectActions.updateProjectMetadata(updates);
      return;
    }
    invalidatePendingImport();
    setDocument((current) => ({
      ...current,
      metadata: Object.fromEntries(
        Object.entries({ ...current.metadata, ...updates }).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    }));
    setDocumentDirty(true);
  };

  /** Keep the original PDF and page image together, including the assets needed by Undo. */
  const applyPdfFigure = async (value: PdfFigureImport) => {
    const extraction = value.extraction
      ? extractionResultSchema.parse(value.extraction)
      : undefined;
    if (
      !editor ||
      editor.isDestroyed ||
      documentWriteLocked ||
      projectActions.busy
    )
      throw new Error(
        locale === 'ja'
          ? '編集できる状態で取り込んでください。'
          : 'Return to the editor before importing.',
      );
    const request = ++importRevision.current;
    const previous = assetStore.assets;
    const next = new Map(previous);
    const created = new Map<string, string>();
    const current = currentDocument(editor, document);
    const old = value.replaceNodeId
      ? [...walkDocumentTree(current.children)].find(
          (node): node is FigureNode =>
            node.type === 'figure' && node.attrs.nodeId === value.replaceNodeId,
        )
      : undefined;
    if (value.replaceNodeId && !old)
      throw new Error(
        locale === 'ja'
          ? '更新対象の図がありません。'
          : 'The figure no longer exists.',
      );
    const assetPath = (source: string) =>
      chapterFile ? resolveProjectPath(chapterFile, source) : source;
    const occupied = imageSources(current.children, current.metadata);
    let registered = false;
    const previousHistory = new Set(pdfHistoryAssets.current);
    try {
      let pdfAsset = value.existingAsset;
      if (pdfAsset && !previous.get(assetPath(pdfAsset))?.startsWith('blob:'))
        throw new Error(
          locale === 'ja'
            ? '元PDFが見つかりません。PDFを選択し直してください。'
            : 'The original PDF is missing. Select its file again.',
        );
      if (!pdfAsset) {
        const original = await createInsertedPdfAsset(
          value.pdf,
          next,
          occupied,
          assetByteTotal(next),
          assetPath,
        );
        pdfAsset = original.source;
        const path = assetPath(original.source);
        next.set(path, original.url);
        created.set(path, original.url);
        occupied.add(original.source);
      }
      const image = createInsertedImageAsset(
        value.image,
        next,
        occupied,
        assetByteTotal(next),
        assetPath,
      );
      const imagePath = assetPath(image.source);
      next.set(imagePath, image.url);
      created.set(imagePath, image.url);
      if (request !== importRevision.current || editor.isDestroyed)
        throw new Error(
          locale === 'ja'
            ? '文書が変更されたため取り込みを中止しました。'
            : 'The document changed during import. Please retry.',
        );
      const samePage =
        old?.attrs.figureEdit?.pdfSource?.asset === pdfAsset &&
        old?.attrs.figureEdit?.pdfSource?.page === value.page;
      const cropped =
        value.crop.x > 0 ||
        value.crop.y > 0 ||
        value.crop.width < 100 ||
        value.crop.height < 100;
      const edit = figureEditSchema.parse({
        ...old?.attrs.figureEdit,
        version: 1,
        name:
          old?.attrs.figureEdit?.name ||
          `${value.fileName} p.${value.page}`.slice(0, 200),
        svgSource: undefined,
        diagram: undefined,
        extraction,
        annotations: samePage ? old?.attrs.figureEdit?.annotations : undefined,
        crop: cropped ? value.crop : undefined,
        imageSize: value.imageSize,
        pdfSource: {
          asset: pdfAsset,
          fileName: value.fileName,
          page: value.page,
          pageCount: value.pageCount,
          dpi: value.dpi,
        },
        source: {
          referenceId: value.reference.id,
          origin: cropped ? 'cropped' : 'original',
          pdfPage: String(value.page),
          printedPage: value.printedPage,
          figureNumber: value.figureNumber,
          note: old?.attrs.figureEdit?.source?.note ?? '',
        },
      });
      const references = figureReferences(previewDocument.metadata).filter(
        (reference) => reference.id !== value.reference.id,
      );
      references.push(value.reference);
      figureReferencesSchema.parse(references);
      const figure: FigureNode = {
        type: 'figure',
        attrs: {
          ...old?.attrs,
          nodeId: old?.attrs.nodeId ?? createNodeId(),
          src: image.source,
          alt:
            old?.attrs.alt ||
            `${value.reference.title || value.fileName} p.${value.page}`,
          title: old?.attrs.title ?? null,
          width: old?.attrs.width ?? 100,
          align: old?.attrs.align ?? 'center',
          figureEdit: edit,
        },
      };
      // Install before the synchronous editor transaction so both rendering and Undo resolve the source.
      for (const path of created.keys()) pdfHistoryAssets.current.add(path);
      pdfHistoryAssets.current.add(assetPath(pdfAsset));
      if (old) {
        pdfHistoryAssets.current.add(assetPath(old.attrs.src));
        if (old.attrs.figureEdit?.pdfSource)
          pdfHistoryAssets.current.add(
            assetPath(old.attrs.figureEdit.pdfSource.asset),
          );
      }
      replaceAssets(next);
      registered = true;
      const pageNumber = insertionPage(editor, value.target);
      const changed = old
        ? updateDocumentNode(
            editor,
            old.attrs.nodeId,
            figure.attrs,
            document.type,
          )
        : insertDocumentBlock(
            editor,
            extraction
              ? [figure, ...extractionBlocks(extraction, value.reference.id)]
              : figure,
            value.target,
          );
      if (!changed)
        throw new Error(
          locale === 'ja'
            ? '図を挿入できませんでした。'
            : 'Could not insert the figure.',
        );
      updateMetadata({ figure_references: references });
      setDocumentDirty(true);
      markProjectEdited();
      selection.focusNode(editor, figure.attrs.nodeId);
      setView('visual');
      setStatus({
        kind: 'success',
        title:
          locale === 'ja'
            ? old
              ? 'PDFの図を更新しました'
              : extraction
                ? `${pageNumber}ページに原本と読み取り結果を挿入しました`
                : `${pageNumber}ページにPDFの図を挿入しました`
            : old
              ? 'PDF figure updated'
              : extraction
                ? `Original and extracted content inserted on page ${pageNumber}`
                : `PDF figure inserted on page ${pageNumber}`,
      });
    } catch (error) {
      pdfHistoryAssets.current = previousHistory;
      if (registered) replaceAssets(previous);
      else revokeAssetUrls(created);
      throw error;
    }
  };

  /** Reader supplements belong to the edited chapter, not the project's combined page IDs. */
  const updateReaderSupplements = (updates: DocumentMetadata) => {
    if (documentWriteLocked) return;
    invalidatePendingImport();
    setDocument((current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        reader_supplements: updates.reader_supplements,
      },
    }));
    setDocumentDirty(true);
    markProjectEdited();
  };

  const updateSlideMetadata = (updates: DocumentMetadata) => {
    if (documentWriteLocked) return;
    invalidatePendingImport();
    setDocument((current) => ({
      ...current,
      metadata: Object.fromEntries(
        Object.entries({
          ...current.metadata,
          slide_design: updates.slide_design,
          slide_presets: updates.slide_presets,
        }).filter(([, value]) => value !== undefined),
      ),
    }));
    setDocumentDirty(true);
    markProjectEdited();
  };

  const applyDocumentChange = (next: DocumentData, message: string) => {
    if (documentWriteLocked || projectActions.busy) return;
    validateChapterDraft(next);
    const previous = currentDocument(editor, document);
    loadDocument(next, statusMessage('editing'), {
      projectAssets: true,
      description: message,
    });
    // Retain all old asset URLs until this explicit Undo can no longer use them.
    pdfHistoryAssets.current = new Set([
      ...pdfHistoryAssets.current,
      ...imageSources(previous.children, previous.metadata),
      ...imageSources(next.children, next.metadata),
    ]);
    setDocumentUndo({
      document: previous,
      after: JSON.stringify(next),
      chapterId: projectSession?.activeChapterId,
      projectSignature: JSON.stringify(projectSession?.project ?? null),
    });
    setDocumentDirty(true);
    markProjectEdited();
  };
  const canUndoDocumentChange = Boolean(
    documentUndo &&
    documentUndo.projectSignature ===
      JSON.stringify(projectSession?.project ?? null) &&
    documentUndo.chapterId === projectSession?.activeChapterId &&
    documentUndo.after === JSON.stringify(document) &&
    !markdownDirty,
  );
  const undoDocumentChange = () => {
    if (
      !canUndoDocumentChange ||
      !documentUndo ||
      documentWriteLocked ||
      projectActions.busy
    )
      return;
    loadDocument(documentUndo.document, statusMessage('editing'), {
      projectAssets: true,
    });
    setDocumentUndo(null);
    setDocumentDirty(true);
    markProjectEdited();
  };

  const focusProjectNode = (nodeId: string) => {
    const chapter = project?.chapters.find((entry) =>
      nodeId.startsWith(`${entry.id}:`),
    );
    if (chapter)
      projectActions.selectChapter(
        chapter.id,
        nodeId.slice(chapter.id.length + 1),
      );
    else selection.focusNode(editor, nodeId);
  };

  const updatePageSettings = (settings: PageSettings) => {
    const pageSettings = pageSettingsSchema.safeParse(settings);
    if (pageSettings.success)
      updateMetadata({ page_settings: pageSettings.data });
  };

  const updateTheme = (theme: string) => updateMetadata({ theme });

  const updateDocumentFlag = (key: DocumentFlag, checked: boolean) =>
    updateMetadata({ [key]: checked });

  return {
    document,
    project,
    projectSession,
    projectActions,
    recovery: pendingRecovery,
    recoveryCandidates,
    recoveryOpen,
    setRecoveryOpen,
    selectRecovery: (savedAt: number) =>
      setRecoveryCandidates((current) =>
        [...current].sort(
          (a, b) =>
            Number(b.savedAt === savedAt) - Number(a.savedAt === savedAt),
        ),
      ),
    recoveryRestoring,
    saveState:
      lastHtmlExportSignature === workspaceSignature
        ? locale === 'ja'
          ? 'HTMLのダウンロード開始済み'
          : 'HTML download started'
        : hasUnsavedChanges
          ? recoverySavedSignature === workspaceSignature
            ? locale === 'ja'
              ? 'ブラウザー内に一時保存済み'
              : 'Temporarily saved in browser'
            : copy.workspace.unsaved
          : locale === 'ja'
            ? '編集待ち'
            : 'Ready to edit',
    restoreRecovery,
    discardRecovery,
    previewDocument,
    localPreviewDocument,
    localAnalysis,
    exportScope,
    setExportScope,
    getExportSnapshot,
    focusProjectNode,
    updateSlideMetadata,
    applyDocumentChange,
    undoDocumentChange,
    canUndoDocumentChange,
    insertionRegion,
    setInsertionRegion,
    editor,
    view,
    markdownDraft,
    documentWriteLocked,
    displayedStatus,
    dirty: hasUnsavedChanges,
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
    applyFootnote: (text: string) => selection.applyFootnote(editor, text),
    resolveImageUrl,
    resolvePreviewImageUrl,
    importFiles,
    pendingHtmlImport,
    confirmHtmlImport,
    cancelHtmlImport,
    insertSlideImage,
    applyPdfFigure,
    updateMarkdown,
    applyMarkdown,
    createDocument,
    loadSample,
    changeView,
    discardMarkdown,
    saveDocument,
    saveArchive,
    exportHtml,
    htmlExporting,
    exportOffice: () => exportBinary('office'),
    exportPdf: () => exportBinary('pdf'),
    binaryExporting,
    updatePageSettings,
    updateTheme,
    updateMetadata,
    updateReaderSupplements,
    updateDocumentFlag,
  };
}
