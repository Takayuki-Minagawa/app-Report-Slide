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

export function EditorWorkspace() {
  const workspace = useDocumentWorkspace();
  const { copy, locale } = useAppPreferences();
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
    workspace.focusNode(nodeId);
  };
  const selectedPageIndex =
    slideNavigationPages(workspace.previewDocument, locale).find((page) =>
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
        workspace.focusNode(nodeId);
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
        document={workspace.previewDocument}
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
                document={workspace.previewDocument}
                currentPageIndex={selectedPageIndex}
                disabled={controlsLocked}
                onApply={workspace.updateMetadata}
                resolveImageUrl={workspace.resolvePreviewImageUrl}
                onFocus={focusTarget}
              />
              <SlideCheckPanel
                document={workspace.previewDocument}
                resolveImageUrl={workspace.resolvePreviewImageUrl}
                onFocus={focusTarget}
                onPageSelect={setCurrentPageIndex}
                disabled={controlsLocked}
              />
            </>
          ) : null}
        </>
      }
      idPrefix={overlay ? 'workspace-sheet' : 'workspace'}
      document={workspace.previewDocument}
      editor={workspace.editor}
      documentWriteLocked={controlsLocked}
      analysis={workspace.analysis}
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
      resolveImageUrl={workspace.resolvePreviewImageUrl}
      updateMetadata={workspace.updateMetadata}
      focusNode={focusTarget}
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
        binaryExporting={workspace.binaryExporting}
        openNavigator={() => setNavigatorOpen(true)}
        openProperties={() => setPropertiesOpen(true)}
        toggleSearch={() => setSearchOpen((open) => !open)}
      />
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
          document={workspace.document}
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
          changeView={workspace.changeView}
          updateMarkdown={workspace.updateMarkdown}
          applyMarkdown={workspace.applyMarkdown}
          discardMarkdown={workspace.discardMarkdown}
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
      <HtmlImportDialog
        importResult={workspace.pendingHtmlImport}
        locale={locale}
        onConfirm={workspace.confirmHtmlImport}
        onCancel={workspace.cancelHtmlImport}
      />
    </main>
  );
}
