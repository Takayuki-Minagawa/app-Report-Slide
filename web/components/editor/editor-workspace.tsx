'use client';

import { useDocumentWorkspace } from './use-document-workspace';
import { WorkspaceHeader } from './workspace-header';
import { WorkspaceNavigator } from './workspace-navigator';
import { WorkspaceEditor } from './workspace-editor';
import { WorkspaceProperties } from './workspace-properties';

export function EditorWorkspace() {
  const workspace = useDocumentWorkspace();

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <WorkspaceHeader
        document={workspace.document}
        editor={workspace.editor}
        dirty={workspace.dirty}
        documentWriteLocked={workspace.documentWriteLocked}
        saveDocument={workspace.saveDocument}
      />
      <section className="workspace-grid">
        <WorkspaceNavigator
          outline={workspace.outline}
          selectedNodeId={workspace.selectedNode?.nodeId}
          documentWriteLocked={workspace.documentWriteLocked}
          focusNode={workspace.focusNode}
          importFiles={workspace.importFiles}
          createDocument={workspace.createDocument}
        />
        <WorkspaceEditor
          document={workspace.document}
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
          document={workspace.document}
          editor={workspace.editor}
          documentWriteLocked={workspace.documentWriteLocked}
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
