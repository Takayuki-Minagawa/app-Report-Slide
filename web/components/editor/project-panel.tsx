'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FolderArchive, Plus, Trash2 } from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DocumentType } from '@/src/document/model';
import { projectSlidePages, type ReportProject } from '@/src/project/model';
import { documentThemes } from '@/src/document/metadata';
import { slideNavigationPages } from '@/src/document/slide-navigation';
import type { useProjectActions } from './use-project-actions';

interface ProjectPanelProps {
  project: ReportProject | null;
  activeChapterId?: string;
  documentType: DocumentType;
  locked: boolean;
  actions: ReturnType<typeof useProjectActions>;
  idPrefix?: string;
  exportScope?: 'project' | 'chapter';
  onExportScope?: (scope: 'project' | 'chapter') => void;
}

export function ProjectPanel({
  project,
  activeChapterId,
  documentType,
  locked,
  actions,
  idPrefix = 'workspace',
  exportScope = 'project',
  onExportScope,
}: ProjectPanelProps) {
  const { copy, locale } = useAppPreferences();
  const ja = locale === 'ja';
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
  const slide = project?.type === 'kumi-slide-project';
  const [pageChoice, setPageChoice] = useState<{
    chapter: string;
    index: number;
  }>({ chapter: '', index: 0 });
  const [destination, setDestination] = useState('');
  const pages = active ? slideNavigationPages(active.document, locale) : [];
  const pageIndex = Math.min(
    pageChoice.chapter === active?.id ? pageChoice.index : 0,
    Math.max(0, pages.length - 1),
  );
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
          disabled={disabled}
          onClick={actions.createProject}
        >
          {documentType === 'slide'
            ? ja
              ? '現在のSlideをプロジェクト化'
              : 'Turn this slide deck into a project'
            : labels.createProject}
        </Button>
      ) : (
        <>
          <label
            className="grid gap-1 text-[11px]"
            htmlFor={`${idPrefix}-project-title`}
          >
            {labels.projectName}
            <Input
              id={`${idPrefix}-project-title`}
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
          {onExportScope && (
            <label className="grid gap-1 text-[11px]">
              {ja ? '書き出す範囲' : 'Export scope'}
              <select
                value={exportScope}
                disabled={disabled}
                onChange={(event) =>
                  onExportScope(event.target.value as 'project' | 'chapter')
                }
              >
                <option value="project">
                  {ja ? '全体（含める章）' : 'Combined included chapters'}
                </option>
                <option value="chapter">
                  {ja ? '編集中の章だけ' : 'Active chapter only'}
                </option>
              </select>
              <span>
                {ja
                  ? 'HTML・PDF・Office・編集用ZIPに適用。プロジェクトZIPは常に全章を保存します。'
                  : 'Applies to HTML, PDF, Office and editable ZIP. Project ZIP always saves all chapters.'}
              </span>
            </label>
          )}
          {slide && (
            <>
              <label className="grid gap-1 text-[11px]">
                {ja ? 'プロジェクトの共通テーマ' : 'Common project theme'}
                <select
                  value={project.metadata.theme ?? 'beamer-simple'}
                  disabled={disabled}
                  onChange={(event) =>
                    actions.updateProjectMetadata({ theme: event.target.value })
                  }
                >
                  {documentThemes.slide.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={project.metadata.project_toc === true}
                  disabled={disabled}
                  onChange={(event) =>
                    actions.updateProjectMetadata({
                      project_toc: event.target.checked,
                    })
                  }
                />
                {ja
                  ? '全体に章目次スライドを付ける'
                  : 'Add chapter contents slides'}
              </label>
              <details>
                <summary className="cursor-pointer text-xs">
                  {ja ? '全体のスライド目次' : 'All chapter slides'}
                </summary>
                <nav
                  aria-label={
                    ja ? '全体スライド目次' : 'Project slide contents'
                  }
                  className="max-h-64 overflow-auto"
                >
                  {projectSlidePages(project).map((page) => (
                    <button
                      type="button"
                      className="navigator-item w-full"
                      disabled={disabled}
                      key={`${page.chapterId}:${page.index}`}
                      onClick={() =>
                        actions.selectChapter(page.chapterId, page.anchorNodeId)
                      }
                    >
                      {page.chapterTitle} / {page.index + 1} — {page.title}
                      {!page.enabled ? (ja ? '（除外中）' : ' (excluded)') : ''}
                    </button>
                  ))}
                </nav>
              </details>
            </>
          )}
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
                  htmlFor={`${idPrefix}-chapter-title`}
                >
                  {labels.renameChapter}
                  <Input
                    id={`${idPrefix}-chapter-title`}
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
              {!slide && (
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
              )}
              {slide && (
                <>
                  <label className="grid gap-1 text-[11px]">
                    {ja ? 'この章のテーマ' : 'Chapter theme'}
                    <select
                      disabled={disabled}
                      value={active.themeOverride ?? ''}
                      onChange={(event) =>
                        actions.updateChapter(active.id, {
                          themeOverride: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">
                        {ja ? '共通テーマを使用' : 'Use the common theme'}
                      </option>
                      {documentThemes.slide.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset
                    disabled={disabled}
                    className="space-y-2 border-t pt-2"
                  >
                    <legend className="text-[11px]">
                      {ja ? '章内スライドの操作' : 'Chapter slide actions'}
                    </legend>
                    <label className="grid gap-1 text-[11px]">
                      {ja ? '操作するスライド' : 'Slide to change'}
                      <select
                        value={pageIndex}
                        onChange={(event) =>
                          setPageChoice({
                            chapter: active.id,
                            index: Number(event.target.value),
                          })
                        }
                      >
                        {pages.map((page) => (
                          <option key={page.index} value={page.index}>
                            {page.index + 1} — {page.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          actions.changeSlidePage(pageIndex, 'duplicate')
                        }
                      >
                        {ja ? 'スライドを複製' : 'Duplicate slide'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={pageIndex === 0}
                        onClick={() => {
                          actions.changeSlidePage(pageIndex, 'up');
                          setPageChoice({
                            chapter: active.id,
                            index: pageIndex - 1,
                          });
                        }}
                      >
                        {ja ? 'スライドを前へ' : 'Move slide earlier'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={pageIndex >= pages.length - 1}
                        onClick={() => {
                          actions.changeSlidePage(pageIndex, 'down');
                          setPageChoice({
                            chapter: active.id,
                            index: pageIndex + 1,
                          });
                        }}
                      >
                        {ja ? 'スライドを後へ' : 'Move slide later'}
                      </Button>
                    </div>
                    <label className="grid gap-1 text-[11px]">
                      {ja ? 'スライドの移動先の章' : 'Move slide to chapter'}
                      <select
                        value={destination === active.id ? '' : destination}
                        onChange={(event) => setDestination(event.target.value)}
                      >
                        <option value="">
                          {ja ? '章を選択' : 'Select a chapter'}
                        </option>
                        {project.chapters
                          .filter((chapter) => chapter.id !== active.id)
                          .map((chapter) => (
                            <option key={chapter.id} value={chapter.id}>
                              {chapter.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!destination || destination === active.id}
                      onClick={() =>
                        actions.changeSlidePage(
                          pageIndex,
                          'transfer',
                          destination,
                        )
                      }
                    >
                      {ja
                        ? '選んだ章の末尾へ移動'
                        : 'Move to the end of that chapter'}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!actions.canUndoSlidePage}
                      onClick={actions.undoSlidePageChange}
                    >
                      {ja
                        ? '直前のスライド操作を取り消す'
                        : 'Undo last slide action'}
                    </Button>
                  </fieldset>
                </>
              )}
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
            accept=".md,.markdown,.json,.html,.htm,.zip,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg,application/pdf,.pdf"
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
