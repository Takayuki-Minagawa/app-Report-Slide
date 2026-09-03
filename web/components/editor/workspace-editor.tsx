'use client';

import { EditorContent, type Editor } from '@tiptap/react';
import { Braces } from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { PreviewSurface } from '@/components/preview/preview-surface';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { DocumentData } from '@/src/document/model';
import type { DocumentAnalysis } from '@/src/document/semantics';
import type { DisplayedWorkspaceStatus } from '@/src/workspace/status';
import type { WorkspaceView } from './use-document-workspace';
import { FormatToolbar } from './format-toolbar';
import { TableToolbar } from './table-toolbar';

interface WorkspaceEditorProps {
  previewDocument?: DocumentData;
  project?: boolean;
  resolvePreviewImageUrl?: (source: string) => string;
  document: DocumentData;
  editor: Editor | null;
  view: WorkspaceView;
  markdownDraft: string;
  analysis: DocumentAnalysis;
  displayedStatus: DisplayedWorkspaceStatus;
  resolveImageUrl: (source: string) => string;
  changeView: (view: WorkspaceView) => void;
  updateMarkdown: (source: string) => void;
  applyMarkdown: () => void;
  discardMarkdown: () => void;
}

export function WorkspaceEditor({
  previewDocument,
  project = false,
  resolvePreviewImageUrl,
  document,
  editor,
  view,
  markdownDraft,
  analysis,
  displayedStatus,
  resolveImageUrl,
  changeView,
  updateMarkdown,
  applyMarkdown,
  discardMarkdown,
}: WorkspaceEditorProps) {
  const { copy } = useAppPreferences();
  return (
    <section className="workspace-center">
      <div className="view-tabs">
        <div className="flex h-full items-end gap-1">
          {(
            [
              ['visual', copy.workspace.visual],
              ['markdown', copy.workspace.markdown],
              ['preview', copy.workspace.preview],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-label={copy.workspace.switchToView(label)}
              className={
                view === value ? 'view-tab view-tab-active' : 'view-tab'
              }
              onClick={() => changeView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">
          {document.type === 'report' ? 'A4' : '16:9'} ・ 100%
        </span>
      </div>

      {view === 'visual' && (
        <>
          <FormatToolbar editor={editor} documentType={document.type} />
          <TableToolbar editor={editor} />
          <ScrollArea className="min-h-0 flex-1">
            <div className="editor-stage">
              <div className={`editor-paper editor-paper-${document.type}`}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </ScrollArea>
        </>
      )}

      {view === 'markdown' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <Textarea
            aria-label={copy.workspace.markdownDraft}
            className="min-h-0 flex-1 resize-none rounded-md bg-[#101923] p-5 font-mono text-[13px] leading-6 text-slate-100"
            value={markdownDraft}
            spellCheck={false}
            onChange={(event) => updateMarkdown(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={discardMarkdown}>
              {copy.workspace.discard}
            </Button>
            <Button onClick={applyMarkdown}>
              <Braces data-icon="inline-start" />
              {copy.workspace.applyMarkdown}
            </Button>
          </div>
        </div>
      )}

      {view === 'preview' && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="preview-stage">
            <PreviewSurface
              document={previewDocument ?? document}
              analysis={analysis}
              resolveImageUrl={resolvePreviewImageUrl ?? resolveImageUrl}
              paginated={project}
            />
          </div>
        </ScrollArea>
      )}

      {displayedStatus.kind === 'error' && (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(620px,calc(100%-32px))] -translate-x-1/2">
          <Alert variant="destructive" className="bg-card shadow-lg">
            <AlertTitle>{displayedStatus.title}</AlertTitle>
            {displayedStatus.description && (
              <AlertDescription>{displayedStatus.description}</AlertDescription>
            )}
          </Alert>
        </div>
      )}
    </section>
  );
}
