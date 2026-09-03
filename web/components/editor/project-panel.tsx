'use client';

import { useRef } from 'react';
import { ArrowDown, ArrowUp, FolderArchive, Plus, Trash2 } from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DocumentType } from '@/src/document/model';
import type { ReportProject } from '@/src/project/model';
import type { useProjectActions } from './use-project-actions';

interface ProjectPanelProps {
  project: ReportProject | null;
  activeChapterId?: string;
  documentType: DocumentType;
  locked: boolean;
  actions: ReturnType<typeof useProjectActions>;
}

export function ProjectPanel({
  project,
  activeChapterId,
  documentType,
  locked,
  actions,
}: ProjectPanelProps) {
  const { copy } = useAppPreferences();
  const labels = copy.project;
  const archiveInput = useRef<HTMLInputElement>(null);
  const chapterInput = useRef<HTMLInputElement>(null);
  const disabled = locked || actions.busy;
  const active = project?.chapters.find(
    (chapter) => chapter.id === activeChapterId,
  );
  const activeIndex =
    project?.chapters.findIndex((chapter) => chapter.id === activeChapterId) ??
    -1;
  return (
    <section
      className="space-y-3 border-b p-3"
      aria-label={labels.panel}
      aria-busy={actions.busy}
    >
      <h2 className="text-xs font-semibold">{labels.panel}</h2>
      <input
        ref={archiveInput}
        className="sr-only"
        type="file"
        accept=".zip,application/zip"
        aria-label={labels.openProject}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void actions.openProject(file);
        }}
      />
      <Button
        className="h-auto min-h-7 w-full justify-start whitespace-normal text-left"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => archiveInput.current?.click()}
      >
        <FolderArchive /> {labels.openProject}
      </Button>
      {!project ? (
        <Button
          className="h-auto min-h-7 w-full whitespace-normal"
          size="sm"
          variant="outline"
          disabled={disabled || documentType !== 'report'}
          onClick={actions.createProject}
        >
          {labels.createProject}
        </Button>
      ) : (
        <>
          <label className="grid gap-1 text-[11px]" htmlFor="project-title">
            {labels.projectName}
            <Input
              id="project-title"
              value={
                typeof project.metadata.title === 'string'
                  ? project.metadata.title
                  : ''
              }
              maxLength={120}
              disabled={disabled}
              onChange={(event) =>
                actions.updateProjectMetadata({ title: event.target.value })
              }
            />
          </label>
          <nav aria-label={labels.chapters}>
            <ol className="space-y-1">
              {project.chapters.map((chapter, index) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-current={
                      chapter.id === activeChapterId ? 'true' : undefined
                    }
                    className={`navigator-item disabled:opacity-50 ${chapter.id === activeChapterId ? 'navigator-item-active' : ''}`}
                    onClick={() => actions.selectChapter(chapter.id)}
                  >
                    <span className="text-[10px] tabular-nums">
                      {index + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={chapter.title}
                    >
                      {chapter.title}
                    </span>
                    {!chapter.enabled && (
                      <span className="text-[9px]">
                        {labels.excludedChapter}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {active && (
            <div className="space-y-2 rounded-md border bg-card p-2">
              <p className="text-[10px] text-muted-foreground">
                {labels.activeChapter}
              </p>
              <form
                key={`${active.id}:${active.title}`}
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const value = data.get('title');
                  const title = typeof value === 'string' ? value.trim() : '';
                  if (title) actions.updateChapter(active.id, { title });
                }}
              >
                <label
                  className="grid gap-1 text-[11px]"
                  htmlFor="chapter-title"
                >
                  {labels.renameChapter}
                  <Input
                    id="chapter-title"
                    name="title"
                    required
                    maxLength={120}
                    defaultValue={active.title}
                    disabled={disabled}
                  />
                </label>
                <Button
                  type="submit"
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                >
                  {labels.rename}
                </Button>
              </form>
              <p className="break-all font-mono text-[9px] text-muted-foreground">
                {active.file}
              </p>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={active.enabled}
                  disabled={disabled}
                  onChange={(event) =>
                    actions.updateChapter(active.id, {
                      enabled: event.target.checked,
                    })
                  }
                />
                {labels.includeChapter}
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={active.pageBreakBefore}
                  disabled={disabled}
                  onChange={(event) =>
                    actions.updateChapter(active.id, {
                      pageBreakBefore: event.target.checked,
                    })
                  }
                />
                {labels.chapterBreak}
              </label>
              <div className="flex gap-1">
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={labels.moveUp}
                  title={labels.moveUp}
                  disabled={disabled || activeIndex <= 0}
                  onClick={() => actions.moveChapter(active.id, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={labels.moveDown}
                  title={labels.moveDown}
                  disabled={
                    disabled || activeIndex === project.chapters.length - 1
                  }
                  onClick={() => actions.moveChapter(active.id, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={disabled || project.chapters.length === 1}
                  onClick={() => actions.deleteChapter(active.id)}
                >
                  <Trash2 />
                  {labels.deleteChapter}
                </Button>
              </div>
            </div>
          )}
          <input
            ref={chapterInput}
            className="sr-only"
            type="file"
            accept=".md,.markdown,.json,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
            multiple
            aria-label={labels.addChapterFiles}
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (files.length) void actions.addChapter(files);
            }}
          />
          <div className="grid gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void actions.addChapter()}
            >
              <Plus />
              {labels.addBlankChapter}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => chapterInput.current?.click()}
            >
              {labels.addChapterFiles}
            </Button>
            <Button
              className="h-auto min-h-7 whitespace-normal"
              size="sm"
              disabled={disabled}
              onClick={() => void actions.saveProject()}
            >
              {labels.saveProject}
            </Button>
            <Button
              className="h-auto min-h-7 whitespace-normal"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => actions.exportProject('markdown')}
            >
              {labels.exportProjectMarkdown}
            </Button>
            <Button
              className="h-auto min-h-7 whitespace-normal"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => actions.exportProject('json')}
            >
              {labels.exportProjectJson}
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {locked ? labels.lockedHint : labels.chapterSaveHint}
          </p>
        </>
      )}
    </section>
  );
}
