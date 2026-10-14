'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { useDocumentWorkspace } from './use-document-workspace';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceNavigator } from './workspace-navigator';
import { WorkspaceEditor } from './workspace-editor';
import { WorkspaceProperties } from './workspace-properties';
import { ProjectPanel } from './project-panel';
import { RecoveryDialog } from './recovery-dialog';
import { SearchReplace } from './search-replace';
import { HtmlImportDialog } from './html-import-dialog';
import { SlideNavigation } from './slide-navigation';
import { SlideDesignPanel } from './slide-design-panel';
import { SlideCheckPanel } from './slide-check-panel';
import { ReaderSupplementProperties } from './reader-supplement-properties';
import { slideNavigationPages } from '@/src/document/slide-navigation';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { PdfImportDialog } from './pdf-import-dialog';
import type { FigureNode } from '@/src/document/model';
import type { BlockInsertionTarget } from '@/src/editor/block-commands';
import { PreservedContentPanel } from './preserved-content-panel';
import { TableSplitDialog } from './table-split-dialog';
import { slideCheckRepairMetadata } from '@/src/document/slide-check';
import { BlockGroupPanel } from './block-group-panel';
import { Button } from '@/components/ui/button';
import {
  OutputPreviewDialog,
  type OutputSnapshot,
} from './output-preview-dialog';

export function EditorWorkspace() {
  const workspace = useDocumentWorkspace();
  const { copy, locale } = useAppPreferences();
  const chapterKey = workspace.projectSession?.activeChapterId ?? 'document';
  const [pageSelection, setPageSelection] = useState({ chapterKey, index: 0 });
  const currentPageIndex =
    pageSelection.chapterKey === chapterKey
      ? Math.min(
          pageSelection.index,
          slideNavigationPages(workspace.document, locale).length - 1,
        )
      : 0;
  const setCurrentPageIndex = (index: number) =>
    setPageSelection({ chapterKey, index });
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outputSnapshot, setOutputSnapshot] = useState<OutputSnapshot | null>(
    null,
  );
  const [outputError, setOutputError] = useState('');
  const [splitTableId, setSplitTableId] = useState<string | null>(null);
  const [pdfImport, setPdfImport] = useState<{
    node?: FigureNode;
    target: BlockInsertionTarget;
  } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const visualView = workspace.view === 'visual';
  // Search covers the visual editor only; other views keep the browser's own find.
  useEffect(() => {
    if (!visualView) return;
    // Ctrl+F moves the cursor in macOS text fields, so use Cmd there.
    const apple = /Mac|iPhone|iPad/.test(window.navigator.platform);
    const openSearch = (event: KeyboardEvent) => {
      if (
        event.key?.toLowerCase() !== 'f' ||
        (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        // The bar would open behind a modal dialog.
        window.document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      event.preventDefault();
      setSearchOpen(true);
      // Already open: return to the query. A new bar focuses itself on mount.
      searchInput.current?.focus();
      searchInput.current?.select();
    };
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, [visualView]);
  const controlsLocked =
    workspace.documentWriteLocked || workspace.projectActions.busy;
  const focusTarget = (nodeId: string) => {
    if (workspace.view !== 'visual') workspace.changeView('visual');
    workspace.focusProjectNode(nodeId);
  };
  const selectedPageIndex =
    slideNavigationPages(workspace.localPreviewDocument, locale).find((page) =>
      page.elements.some(
        (element) => element.nodeId === workspace.selectedNode?.nodeId,
      ),
    )?.index ?? currentPageIndex;
  const editedPageIndex =
    slideNavigationPages(workspace.document, locale).find((page) =>
      page.elements.some(
        (element) => element.nodeId === workspace.selectedNode?.nodeId,
      ),
    )?.index ?? 0;
  const projectPanel = (overlay: boolean) => (
    <ProjectPanel
      idPrefix={overlay ? 'workspace-sheet' : 'workspace'}
      project={workspace.project}
      activeChapterId={workspace.projectSession?.activeChapterId}
      documentType={workspace.document.type}
      locked={workspace.documentWriteLocked}
      actions={workspace.projectActions}
    />
  );
  const navigator = (overlay = false) => (
    <WorkspaceNavigator
      overlay={overlay}
      projectPanel={projectPanel(overlay)}
      outline={workspace.outline}
      selectedNodeId={workspace.selectedNode?.nodeId}
      documentWriteLocked={controlsLocked}
      focusNode={(nodeId) => {
        workspace.focusProjectNode(nodeId);
        if (overlay) setNavigatorOpen(false);
      }}
      importFiles={workspace.importFiles}
      createDocument={workspace.createDocument}
      loadSample={workspace.loadSample}
      openRecovery={() => {
        setNavigatorOpen(false);
        workspace.setRecoveryOpen(true);
      }}
    >
      <SlideNavigation
        document={workspace.localPreviewDocument}
        selectedNodeId={workspace.selectedNode?.nodeId}
        currentPageIndex={selectedPageIndex}
        onPageSelect={setCurrentPageIndex}
        onFocus={(nodeId) => {
          focusTarget(nodeId);
          if (overlay) setNavigatorOpen(false);
        }}
      />
    </WorkspaceNavigator>
  );
  const properties = (overlay = false) => (
    <WorkspaceProperties
      overlay={overlay}
      slideTools={
        <>
          <PreservedContentPanel
            document={workspace.document}
            onFocus={focusTarget}
          />
          <BlockGroupPanel
            key={`blocks:${workspace.projectSession?.activeChapterId ?? 'document'}:${selectedPageIndex}`}
            document={workspace.document}
            currentPageIndex={selectedPageIndex}
            disabled={controlsLocked}
            selectedNodeId={workspace.selectedNode?.nodeId}
            onFocus={focusTarget}
            onApply={workspace.applyDocumentChange}
            onInsertionRegionChange={workspace.setInsertionRegion}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={controlsLocked || !workspace.canUndoDocumentChange}
            onClick={workspace.undoDocumentChange}
          >
            {locale === 'ja'
              ? 'まとまり・配置の変更を取り消す'
              : 'Undo block / layout change'}
          </Button>
          {workspace.insertionRegion && (
            <div className="rounded border p-2 text-xs">
              <output>
                {locale === 'ja'
                  ? `次の新しい図表の領域: ${{ full: '全幅上部', left: '主領域', 'right-top': '副領域上', 'right-bottom': '副領域下', bottom: '全幅下部' }[workspace.insertionRegion]}（挿入ページは本文の選択位置）`
                  : `Next figure/table region: ${workspace.insertionRegion} (page follows the editor selection)`}
              </output>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => workspace.setInsertionRegion(undefined)}
              >
                {locale === 'ja' ? '領域指定を解除' : 'Clear insertion region'}
              </Button>
            </div>
          )}
          <ReaderSupplementProperties
            key={`reader:${workspace.document.children[0]?.attrs.nodeId}:${editedPageIndex}:${JSON.stringify(workspace.document.metadata.reader_supplements)}`}
            document={workspace.document}
            pageIndex={editedPageIndex}
            disabled={controlsLocked}
            onMetadata={workspace.updateReaderSupplements}
          />
          {workspace.document.type === 'slide' ? (
            <>
              <SlideDesignPanel
                document={workspace.localPreviewDocument}
                currentPageIndex={selectedPageIndex}
                disabled={controlsLocked}
                onApply={workspace.updateSlideMetadata}
                resolveImageUrl={workspace.resolveImageUrl}
                onFocus={focusTarget}
              />
              <SlideCheckPanel
                document={workspace.localPreviewDocument}
                resolveImageUrl={workspace.resolveImageUrl}
                onFocus={focusTarget}
                onPageSelect={setCurrentPageIndex}
                disabled={controlsLocked}
                onRepair={(nodeId, action) => {
                  focusTarget(nodeId);
                  if (action === 'split-table') setSplitTableId(nodeId);
                  else {
                    const metadata = slideCheckRepairMetadata(
                      workspace.document,
                      nodeId,
                      action,
                    );
                    if (metadata)
                      workspace.applyDocumentChange(
                        { ...workspace.document, metadata },
                        locale === 'ja'
                          ? '表を全幅へ配置しました'
                          : 'Placed table at full width',
                      );
                  }
                }}
              />
            </>
          ) : null}
        </>
      }
      idPrefix={overlay ? 'workspace-sheet' : 'workspace'}
      document={workspace.localPreviewDocument}
      editor={workspace.editor}
      documentWriteLocked={controlsLocked}
      analysis={workspace.localAnalysis}
      selectedNode={workspace.selectedNode}
      selectedSemantic={workspace.selectedSemantic}
      mathDraft={workspace.mathDraft}
      setMathDraft={workspace.setMathDraft}
      applyMath={workspace.applyMath}
      applyAttributes={workspace.applyAttributes}
      applyFootnote={workspace.applyFootnote}
      updatePageSettings={workspace.updatePageSettings}
      updateTheme={workspace.updateTheme}
      updateDocumentFlag={workspace.updateDocumentFlag}
      displayedStatus={workspace.displayedStatus}
      dirty={workspace.dirty}
      resolveImageUrl={workspace.resolveImageUrl}
      updateMetadata={workspace.updateMetadata}
      focusNode={focusTarget}
      onEditPdf={(node) => {
        setPropertiesOpen(false);
        setPdfImport({ node, target: 'after-block' });
      }}
    />
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <WorkspaceHeader
        document={workspace.previewDocument}
        project={Boolean(workspace.project)}
        editor={workspace.editor}
        dirty={workspace.dirty}
        saveState={workspace.saveState}
        documentWriteLocked={workspace.documentWriteLocked}
        saveDocument={workspace.saveDocument}
        saveArchive={workspace.saveArchive}
        exportHtml={workspace.exportHtml}
        htmlExporting={workspace.htmlExporting}
        exportOffice={workspace.exportOffice}
        exportPdf={workspace.exportPdf}
        exportScope={workspace.exportScope}
        setExportScope={workspace.setExportScope}
        openOutputPreview={() => {
          try {
            setOutputError('');
            setOutputSnapshot(workspace.getExportSnapshot());
          } catch (cause) {
            setOutputError(
              cause instanceof Error ? cause.message : String(cause),
            );
          }
        }}
        binaryExporting={workspace.binaryExporting}
        openNavigator={() => setNavigatorOpen(true)}
        openProperties={() => setPropertiesOpen(true)}
        toggleSearch={() => setSearchOpen((open) => !open)}
      />
      {outputError && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {outputError}
        </p>
      )}
      {outputSnapshot && (
        <OutputPreviewDialog
          snapshot={outputSnapshot}
          onClose={() => setOutputSnapshot(null)}
        />
      )}
      {searchOpen && (
        <SearchReplace
          editor={workspace.editor}
          locked={controlsLocked}
          inputRef={searchInput}
          onClose={() => {
            setSearchOpen(false);
            // Return to the text without moving the page under the reader.
            workspace.editor?.commands.focus(undefined, {
              scrollIntoView: false,
            });
          }}
        />
      )}
      <section className="workspace-grid">
        {navigator()}
        <WorkspaceEditor
          document={workspace.localPreviewDocument}
          previewDocument={workspace.previewDocument}
          project={Boolean(workspace.project)}
          resolvePreviewImageUrl={workspace.resolvePreviewImageUrl}
          editor={workspace.editor}
          view={workspace.view}
          markdownDraft={workspace.markdownDraft}
          analysis={workspace.analysis}
          displayedStatus={workspace.displayedStatus}
          resolveImageUrl={workspace.resolveImageUrl}
          selectedNodeId={workspace.selectedNode?.nodeId}
          documentWriteLocked={controlsLocked}
          focusNode={workspace.focusNode}
          applyAttributes={workspace.applyAttributes}
          insertSlideImage={workspace.insertSlideImage}
          insertImage={workspace.insertImage}
          changeView={workspace.changeView}
          updateMarkdown={workspace.updateMarkdown}
          applyMarkdown={workspace.applyMarkdown}
          discardMarkdown={workspace.discardMarkdown}
          openPdfImport={(target) => setPdfImport({ target })}
        />
        {properties()}
      </section>
      <Sheet open={navigatorOpen} onOpenChange={setNavigatorOpen}>
        <SheetContent side="left" className="workspace-sheet p-0">
          <SheetTitle className="sr-only">
            {copy.workspace.documentPanel}
          </SheetTitle>
          {navigator(true)}
        </SheetContent>
      </Sheet>
      <Sheet open={propertiesOpen} onOpenChange={setPropertiesOpen}>
        <SheetContent side="right" className="workspace-sheet p-0">
          <SheetTitle className="sr-only">
            {copy.workspace.propertiesPanel}
          </SheetTitle>
          {properties(true)}
        </SheetContent>
      </Sheet>
      <RecoveryDialog
        open={workspace.recoveryOpen}
        onClose={() => workspace.setRecoveryOpen(false)}
        candidates={workspace.recoveryCandidates}
        onSelect={workspace.selectRecovery}
        recovery={workspace.recovery}
        restoring={workspace.recoveryRestoring}
        onRestore={() => void workspace.restoreRecovery()}
        onDiscard={() => void workspace.discardRecovery()}
      />
      {pdfImport && (
        <PdfImportDialog
          node={pdfImport.node}
          target={pdfImport.target}
          metadata={workspace.localPreviewDocument.metadata}
          resolveAssetUrl={workspace.resolveImageUrl}
          onApply={workspace.applyPdfFigure}
          onClose={() => setPdfImport(null)}
        />
      )}
      {splitTableId && workspace.editor && (
        <TableSplitDialog
          editor={workspace.editor}
          nodeId={splitTableId}
          documentType={workspace.document.type}
          onClose={() => setSplitTableId(null)}
        />
      )}
      <HtmlImportDialog
        importResult={workspace.pendingHtmlImport}
        locale={locale}
        onConfirm={workspace.confirmHtmlImport}
        onCancel={workspace.cancelHtmlImport}
      />
    </main>
  );
}
