'use client';

import { useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { useDocumentWorkspace } from './use-document-workspace';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceNavigator } from './workspace-navigator';
import { WorkspaceEditor } from './workspace-editor';
import { WorkspaceProperties } from './workspace-properties';
import { ProjectPanel } from './project-panel';
import { RecoveryDialog } from './recovery-dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

export function EditorWorkspace() {
  const workspace = useDocumentWorkspace();
  const { copy } = useAppPreferences();
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const controlsLocked =
    workspace.documentWriteLocked || workspace.projectActions.busy;
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
    />
  );
  const properties = (overlay = false) => (
    <WorkspaceProperties
      overlay={overlay}
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
      updateTheme={workspace.updateTheme}
      updateDocumentFlag={workspace.updateDocumentFlag}
      displayedStatus={workspace.displayedStatus}
      dirty={workspace.dirty}
    />
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <WorkspaceHeader
        document={workspace.previewDocument}
        project={Boolean(workspace.project)}
        editor={workspace.editor}
        dirty={workspace.dirty}
        documentWriteLocked={workspace.documentWriteLocked}
        saveDocument={workspace.saveDocument}
        exportHtml={workspace.exportHtml}
        htmlExporting={workspace.htmlExporting}
        openNavigator={() => setNavigatorOpen(true)}
        openProperties={() => setPropertiesOpen(true)}
      />
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
        recovery={workspace.recovery}
        restoring={workspace.recoveryRestoring}
        onRestore={() => void workspace.restoreRecovery()}
        onDiscard={() => void workspace.discardRecovery()}
      />
    </main>
  );
}
