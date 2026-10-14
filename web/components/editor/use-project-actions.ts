'use client';

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  documentTitle,
  type DocumentData,
  type DocumentMetadata,
} from '@/src/document/model';
import { prepareChapter, pruneProjectAssets } from '@/src/project/assets';
import {
  assembleReportProject,
  appendReportProjectChapter,
  updateReportProjectDocument,
  createBlankChapter,
  createDocumentProject,
  projectDocumentType,
  projectChapterDocument,
  maximumProjectChapters,
  ReportProjectError,
  validateReportProject,
  type ReportChapter,
  type ReportProject,
} from '@/src/project/model';
import {
  duplicateSlidePage,
  moveSlidePage,
  transferSlidePage,
} from '@/src/project/slide-pages';
import {
  readWorkspaceFiles,
  revokeAssetUrls,
  downloadFile,
  downloadDocument,
  type AssetUrls,
  type DocumentFileFormat,
} from '@/src/workspace/files';
import {
  describeWorkspaceError,
  diagnosticStatusMessage,
  projectStatus,
  type StatusDescription,
  type StatusMessage,
  type WorkspaceStatus,
} from '@/src/workspace/status';
import type { ProjectMessages } from '@/src/i18n/project-messages';

export interface ProjectSession {
  project: ReportProject;
  activeChapterId: string;
  dirty: boolean;
}

export function projectWithDocument(
  session: ProjectSession,
  document: DocumentData,
): ReportProject {
  return updateReportProjectDocument(
    session.project,
    session.activeChapterId,
    document,
  );
}

interface ProjectWorkspaceBridge {
  session: ProjectSession | null;
  setSession: Dispatch<SetStateAction<ProjectSession | null>>;
  getDocument: () => DocumentData;
  loadDocument: (
    document: DocumentData,
    title: StatusMessage,
    options?: {
      assets?: AssetUrls;
      description?: StatusDescription;
      projectAssets?: boolean;
      focusNodeId?: string;
    },
  ) => void;
  assets: AssetUrls;
  getRevision: () => number;
  nextRevision: () => number;
  locked: boolean;
  setStatus: Dispatch<SetStateAction<WorkspaceStatus>>;
  showEditor: () => void;
  markDocumentSaved: () => void;
  clearRecovery: () => void;
  confirmReplacement: () => boolean;
  focusNode?: (nodeId: string) => void;
  copy: ProjectMessages;
}

/** Coordinates asynchronous project work using the workspace's edit/replacement revision. */
export function useProjectActions(bridge: ProjectWorkspaceBridge) {
  const {
    session,
    setSession,
    getDocument,
    loadDocument,
    assets,
    getRevision,
    nextRevision,
    locked,
    setStatus,
    showEditor,
    markDocumentSaved,
    clearRecovery,
    confirmReplacement,
    copy,
  } = bridge;
  const [busy, setBusy] = useState(false);
  const [pageUndo, setPageUndo] = useState<{
    session: ProjectSession;
    revision: number;
  } | null>(null);
  const activeOperation = useRef<number | null>(null);
  useEffect(
    () => () => {
      activeOperation.current = null;
    },
    [],
  );
  const snapshot = () =>
    session ? projectWithDocument(session, getDocument()) : null;
  const errorStatus = (
    error: unknown,
    action: 'unableToOpen' | 'unableToSave' | 'unableToChange',
  ) => {
    setStatus({
      kind: 'error',
      title: projectStatus(action),
      description: describeWorkspaceError(error, 'invalidDocumentData'),
    });
  };
  const begin = () => {
    if (locked || activeOperation.current !== null) return null;
    const request = nextRevision();
    activeOperation.current = request;
    setBusy(true);
    return request;
  };
  const finish = (request: number) => {
    if (activeOperation.current === request) {
      activeOperation.current = null;
      setBusy(false);
    }
  };

  const createProject = () => {
    if (locked || session || busy) return;
    try {
      const project = createDocumentProject(getDocument());
      const prepared = prepareChapter(project.chapters[0], assets);
      project.chapters[0] = prepared.chapter;
      validateReportProject(project);
      loadDocument(prepared.chapter.document, projectStatus('created'), {
        assets: prepared.assets,
        projectAssets: true,
      });
      setSession({
        project,
        activeChapterId: prepared.chapter.id,
        dirty: true,
      });
      showEditor();
    } catch (error) {
      errorStatus(error, 'unableToChange');
    }
  };

  const openProject = async (file: File) => {
    if (locked || busy || !confirmReplacement()) return;
    const request = begin();
    if (request === null) return;
    let pendingAssets: AssetUrls | undefined;
    try {
      const { readReportProject } = await import('@/src/project/archive');
      if (request !== getRevision()) return;
      const result = await readReportProject(file);
      pendingAssets = result.assets;
      if (request !== getRevision()) return;
      const chapter = result.project.chapters[0];
      loadDocument(chapter.document, projectStatus('opened', file.name), {
        assets: result.assets,
        projectAssets: true,
        description: result.diagnostics.map(diagnosticStatusMessage),
      });
      setSession({
        project: result.project,
        activeChapterId: chapter.id,
        dirty: false,
      });
      clearRecovery();
      pendingAssets = undefined;
      showEditor();
    } catch (error) {
      if (request === getRevision()) errorStatus(error, 'unableToOpen');
    } finally {
      if (pendingAssets) revokeAssetUrls(pendingAssets);
      finish(request);
    }
  };

  const selectChapter = (id: string, focusNodeId?: string) => {
    if (!session || locked || busy) return;
    if (id === session.activeChapterId) {
      if (focusNodeId) bridge.focusNode?.(focusNodeId);
      return;
    }
    const project = snapshot()!;
    const chapter = project.chapters.find((candidate) => candidate.id === id);
    if (!chapter) return;
    loadDocument(
      projectChapterDocument(project, chapter),
      projectStatus('chapterSelected', chapter.title),
      { projectAssets: true, focusNodeId },
    );
    setSession({ ...session, project, activeChapterId: id });
    showEditor();
  };

  const addChapter = async (files?: readonly File[]) => {
    if (!session || locked || busy) return;
    const project = snapshot()!;
    const request = begin();
    if (request === null) return;
    let pendingAssets: AssetUrls | undefined;
    try {
      if (project.chapters.length >= maximumProjectChapters)
        throw new ReportProjectError('tooManyFiles');
      let chapter = createBlankChapter(
        project.chapters.length + 1,
        copy.newChapter(project.chapters.length + 1),
        projectDocumentType(project),
      );
      let nextAssets = assets;
      let description: StatusDescription | undefined;
      if (files?.length) {
        const imported = await readWorkspaceFiles(files);
        pendingAssets = imported.assets;
        if (request !== getRevision()) return;
        if (imported.document.type !== projectDocumentType(project))
          throw new ReportProjectError('reportOnly');
        chapter = {
          ...chapter,
          title: documentTitle(imported.document).slice(0, 120),
          document: imported.document,
          ...(project.type === 'kumi-slide-project' &&
          imported.document.metadata.theme &&
          imported.document.metadata.theme !== project.metadata.theme
            ? { themeOverride: imported.document.metadata.theme }
            : {}),
        };
        if (/\.json$/i.test(imported.sourceName))
          chapter.file = chapter.file.replace(/\.md$/, '.json');
        const prepared = prepareChapter(chapter, imported.assets);
        chapter = prepared.chapter;
        nextAssets = new Map([...assets, ...prepared.assets]);
        description = [
          ...imported.diagnostics.map(diagnosticStatusMessage),
          ...(imported.htmlImport?.warnings ?? []),
          ...imported.unresolved.map((source) =>
            projectStatus('missingImage', source),
          ),
        ];
      }
      if (request !== getRevision()) return;
      const next = validateReportProject(
        appendReportProjectChapter(project, chapter),
      );
      chapter = next.chapters.find((candidate) => candidate.id === chapter.id)!;
      loadDocument(
        chapter.document,
        projectStatus('chapterAdded', chapter.title),
        { assets: nextAssets, description, projectAssets: true },
      );
      setSession({ project: next, activeChapterId: chapter.id, dirty: true });
      if (pendingAssets) {
        const retained = new Set(nextAssets.values());
        revokeAssetUrls(
          new Map([...pendingAssets].filter(([, url]) => !retained.has(url))),
        );
      }
      pendingAssets = undefined;
      showEditor();
    } catch (error) {
      if (request === getRevision()) errorStatus(error, 'unableToChange');
    } finally {
      if (pendingAssets) revokeAssetUrls(pendingAssets);
      finish(request);
    }
  };

  const updateChapter = (
    id: string,
    updates: Partial<
      Pick<
        ReportChapter,
        'title' | 'enabled' | 'pageBreakBefore' | 'themeOverride'
      >
    >,
  ) => {
    if (!session || locked || busy) return;
    try {
      const project = snapshot()!;
      const next = validateReportProject({
        ...project,
        chapters: project.chapters.map((chapter) =>
          chapter.id === id ? { ...chapter, ...updates } : chapter,
        ),
      });
      nextRevision();
      setSession({ ...session, project: next, dirty: true });
      setStatus({ kind: 'success', title: projectStatus('chapterUpdated') });
    } catch (error) {
      errorStatus(error, 'unableToChange');
    }
  };

  const moveChapter = (id: string, delta: -1 | 1) => {
    if (!session || locked || busy) return;
    const project = snapshot()!;
    const index = project.chapters.findIndex((chapter) => chapter.id === id);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= project.chapters.length)
      return;
    const chapters = [...project.chapters];
    [chapters[index], chapters[destination]] = [
      chapters[destination],
      chapters[index],
    ];
    nextRevision();
    setSession({ ...session, project: { ...project, chapters }, dirty: true });
    setStatus({ kind: 'success', title: projectStatus('chapterUpdated') });
  };

  const deleteChapter = (id: string) => {
    if (!session || locked || busy) return;
    const project = snapshot()!;
    const removed = project.chapters.find((chapter) => chapter.id === id);
    if (!removed) return;
    if (project.chapters.length === 1) {
      errorStatus(new ReportProjectError('lastChapter'), 'unableToChange');
      return;
    }
    if (!window.confirm(copy.deleteConfirmation(removed.title))) return;
    const next = {
      ...project,
      chapters: project.chapters.filter((chapter) => chapter.id !== id),
    };
    const active =
      next.chapters.find((chapter) => chapter.id === session.activeChapterId) ??
      next.chapters[0];
    // Replacing assets recreates image extensions; seed them with the latest source.
    loadDocument(
      active.document,
      projectStatus('chapterDeleted', removed.title),
      { assets: pruneProjectAssets(next, assets), projectAssets: true },
    );
    setSession({ project: next, activeChapterId: active.id, dirty: true });
    showEditor();
  };

  const updateProjectMetadata = (updates: Partial<DocumentMetadata>) => {
    if (!session || locked || busy) return;
    let project = snapshot()!;
    if (updates.figure_references !== undefined) {
      const active = project.chapters.find(
        (chapter) => chapter.id === session.activeChapterId,
      )!;
      project = updateReportProjectDocument(project, active.id, {
        ...active.document,
        metadata: {
          ...active.document.metadata,
          figure_references: updates.figure_references,
        },
      });
    }
    nextRevision();
    setSession((current) =>
      current
        ? {
            ...current,
            project: {
              ...project,
              metadata: {
                ...project.metadata,
                ...current.project.metadata,
                ...(project.metadata.figure_references !== undefined
                  ? { figure_references: project.metadata.figure_references }
                  : {}),
                ...updates,
              },
            },
            dirty: true,
          }
        : current,
    );
  };

  const saveProject = async () => {
    const project = snapshot();
    if (!project) return;
    const request = begin();
    if (request === null) return;
    try {
      const { writeReportProject } = await import('@/src/project/archive');
      if (request !== getRevision()) return;
      const bytes = await writeReportProject(project, assets);
      if (request !== getRevision()) return;
      downloadFile(
        assembleReportProject(project),
        'kumi.zip',
        new Uint8Array(bytes),
        'application/zip',
      );
      setSession((current) =>
        current ? { ...current, project, dirty: false } : current,
      );
      markDocumentSaved();
      setStatus({ kind: 'success', title: projectStatus('saved') });
    } catch (error) {
      if (request === getRevision()) errorStatus(error, 'unableToSave');
    } finally {
      finish(request);
    }
  };

  const exportProject = (format: DocumentFileFormat) => {
    const project = snapshot();
    if (!project || locked || busy) return;
    nextRevision();
    try {
      downloadDocument(assembleReportProject(project), format);
      setStatus({ kind: 'success', title: projectStatus('projectExported') });
    } catch (error) {
      errorStatus(error, 'unableToSave');
    }
  };

  const changeSlidePage = (
    index: number,
    operation: 'duplicate' | 'up' | 'down' | 'transfer',
    destinationId?: string,
  ) => {
    if (!session || locked || busy) return;
    const before = snapshot()!;
    const chapter = before.chapters.find(
      (entry) => entry.id === session.activeChapterId,
    )!;
    if (chapter.document.type !== 'slide') return;
    let next: ReportProject;
    const assetCopies = new Map<string, string>();
    let activeId = chapter.id;
    if (operation === 'transfer' && destinationId) {
      next = transferSlidePage(
        before,
        chapter.id,
        index,
        destinationId,
        assetCopies,
      );
      activeId = destinationId;
    } else {
      const document =
        operation === 'duplicate'
          ? duplicateSlidePage(projectChapterDocument(before, chapter), index)
          : moveSlidePage(
              chapter.document,
              index,
              index + (operation === 'up' ? -1 : 1),
            );
      next = updateReportProjectDocument(before, chapter.id, document);
    }
    try {
      next = validateReportProject(next);
      const nextAssets = new Map(assets);
      for (const [destination, source] of assetCopies) {
        const url = assets.get(source);
        if (!url) throw new ReportProjectError('missingImage', source);
        nextAssets.set(destination, url);
      }
      const active = next.chapters.find((entry) => entry.id === activeId)!;
      loadDocument(
        projectChapterDocument(next, active),
        projectStatus('chapterUpdated'),
        { projectAssets: true, assets: nextAssets },
      );
      setPageUndo({
        session: { ...session, project: before },
        revision: getRevision(),
      });
      setSession({ project: next, activeChapterId: activeId, dirty: true });
      showEditor();
    } catch (error) {
      errorStatus(error, 'unableToChange');
    }
  };

  const undoSlidePageChange = () => {
    if (!pageUndo || locked || busy || pageUndo.revision !== getRevision())
      return;
    const previous = pageUndo.session;
    const active = previous.project.chapters.find(
      (chapter) => chapter.id === previous.activeChapterId,
    )!;
    loadDocument(
      projectChapterDocument(previous.project, active),
      projectStatus('chapterUpdated'),
      { projectAssets: true },
    );
    setSession({ ...previous, dirty: true });
    setPageUndo(null);
  };

  return {
    busy,
    createProject,
    openProject,
    selectChapter,
    addChapter,
    updateChapter,
    moveChapter,
    deleteChapter,
    updateProjectMetadata,
    saveProject,
    exportProject,
    changeSlidePage,
    undoSlidePageChange,
    canUndoSlidePage: Boolean(pageUndo && pageUndo.revision === getRevision()),
  };
}
