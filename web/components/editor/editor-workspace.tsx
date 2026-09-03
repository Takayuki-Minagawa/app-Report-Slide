'use client';

import { useDocumentWorkspace } from './use-document-workspace';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceNavigator } from './workspace-navigator';
import { WorkspaceEditor } from './workspace-editor';
import { WorkspaceProperties } from './workspace-properties';
import { ProjectPanel } from './project-panel';

export function EditorWorkspace() {
  const workspace = useDocumentWorkspace();

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
      />
      <section className="workspace-grid">
        <WorkspaceNavigator
          projectPanel={
            <ProjectPanel
              project={workspace.project}
              activeChapterId={workspace.projectSession?.activeChapterId}
              documentType={workspace.document.type}
              locked={workspace.documentWriteLocked}
              actions={workspace.projectActions}
            />
          }
          outline={workspace.outline}
          selectedNodeId={workspace.selectedNode?.nodeId}
          documentWriteLocked={
            workspace.documentWriteLocked || workspace.projectActions.busy
          }
          focusNode={workspace.focusNode}
          importFiles={workspace.importFiles}
          createDocument={workspace.createDocument}
        />
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
        <WorkspaceProperties
          document={workspace.previewDocument}
          editor={workspace.editor}
          documentWriteLocked={
            workspace.documentWriteLocked || workspace.projectActions.busy
          }
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
      </section>
    </main>
  );
}
