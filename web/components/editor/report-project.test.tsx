import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppPreferencesProvider } from '@/components/app-preferences';
import * as files from '@/src/workspace/files';
import * as archive from '@/src/project/archive';
import { parseMarkdown } from '@/src/markdown/parser';
import { createReportProject } from '@/src/project/model';
import { useDocumentWorkspace } from './use-document-workspace';

function wrapper({ children }: { children: ReactNode }) {
  return <AppPreferencesProvider>{children}</AppPreferencesProvider>;
}

function sourceFile(
  source: string | Promise<string>,
  name = 'chapter.md',
): File {
  const file = new File([], name, { type: 'text/markdown' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
  return file;
}

async function workspace(
  source = '# First\n{#sec:first}\n\nFirst chapter content',
) {
  const hook = renderHook(useDocumentWorkspace, { wrapper });
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  await act(async () => {
    await hook.result.current.importFiles([sourceFile(source)]);
  });
  act(() => hook.result.current.projectActions.createProject());
  expect(hook.result.current.project?.chapters).toHaveLength(1);
  return hook;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(files, 'downloadDocument').mockImplementation(() => {});
  vi.spyOn(files, 'downloadFile').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('chapter workspace lifecycle', () => {
  it('edits only the active chapter, retains changes across switches and resets cross-file undo', async () => {
    const { result } = await workspace();
    const first = result.current.projectSession!.activeChapterId;
    act(() => {
      result.current.editor!.commands.insertContent('Changed first');
    });
    await act(async () => {
      await result.current.projectActions.addChapter([
        sourceFile('# Second\n{#sec:second}\n\nSecond content'),
      ]);
    });
    const second = result.current.projectSession!.activeChapterId;
    expect(result.current.editor!.getText()).toContain('Second content');
    expect(result.current.editor!.getText()).not.toContain('Changed first');
    act(() => {
      result.current.editor!.commands.insertContent('Changed second');
    });
    act(() => {
      result.current.projectActions.selectChapter(first);
    });
    expect(result.current.editor!.getText()).toContain('Changed first');
    expect(result.current.editor!.can().undo()).toBe(false);
    act(() => {
      result.current.projectActions.selectChapter(second);
    });
    expect(result.current.editor!.getText()).toContain('Changed second');
    expect(result.current.projectSession!.dirty).toBe(true);
  });

  it('uses project metadata and global references without rewriting chapter metadata', async () => {
    const { result } = await workspace(
      '---\ntitle: Chapter source\ncustom: preserve\n---\n\n# First\n{#sec:first}\n\n[@sec:second]',
    );
    await act(async () => {
      await result.current.projectActions.addChapter([
        sourceFile('# Second\n{#sec:second}'),
      ]);
    });
    act(() => {
      result.current.updateDocumentFlag('number_sections', true);
      result.current.updateTheme('technical');
    });
    expect(result.current.analysis.labels.get('sec:second')?.number).toBe('2');
    expect(result.current.analysis.diagnostics).toEqual([]);
    expect(result.current.project!.metadata.theme).toBe('technical');
    expect(result.current.project!.chapters[0].document.metadata.custom).toBe(
      'preserve',
    );
    expect(
      result.current.project!.chapters[0].document.metadata.number_sections,
    ).not.toBe(true);
    const second = result.current.projectSession!.activeChapterId;
    act(() => {
      result.current.projectActions.moveChapter(second, -1);
    });
    expect(result.current.analysis.labels.get('sec:second')?.number).toBe('1');
    act(() => {
      result.current.projectActions.updateChapter(second, { enabled: false });
    });
    expect(result.current.analysis.labels.has('sec:second')).toBe(false);
    expect(result.current.analysis.diagnostics).toHaveLength(1);
    expect(result.current.project!.chapters).toHaveLength(2);
  });

  it('distinguishes source saves, combined export and saving the entire project', async () => {
    const { result } = await workspace();
    const save = vi
      .spyOn(archive, 'writeReportProject')
      .mockResolvedValue(new Uint8Array([1]));
    act(() => {
      result.current.saveDocument('json');
    });
    expect(result.current.dirty).toBe(true);
    act(() => {
      result.current.projectActions.exportProject('markdown');
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await result.current.projectActions.saveProject();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(files.downloadFile).toHaveBeenCalledTimes(1);
    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.editor!.commands.insertContent('More');
    });
    act(() => {
      result.current.saveDocument('markdown');
    });
    expect(result.current.dirty).toBe(true);
  });

  it('blocks chapter operations on Markdown drafts and rejects Slide front matter', async () => {
    const { result } = await workspace();
    const before = result.current.project!;
    act(() => {
      result.current.changeView('markdown');
    });
    act(() => {
      result.current.updateMarkdown('---\ntype: slide\n---\n# Wrong type');
    });
    await act(async () => {
      await result.current.projectActions.addChapter();
    });
    expect(result.current.project!.chapters).toHaveLength(1);
    act(() => {
      result.current.applyMarkdown();
    });
    expect(result.current.displayedStatus.kind).toBe('error');
    expect(result.current.document.type).toBe('report');
    expect(result.current.markdownDraft).toContain('type: slide');
    expect(result.current.project!.chapters[0].id).toBe(before.chapters[0].id);
    act(() => {
      result.current.discardMarkdown();
    });
    expect(result.current.documentWriteLocked).toBe(false);
  });

  it('discarding a draft in a saved project does not create a false dirty state', async () => {
    const { result } = await workspace();
    vi.spyOn(archive, 'writeReportProject').mockResolvedValue(new Uint8Array());
    await act(async () => {
      await result.current.projectActions.saveProject();
    });
    act(() => {
      result.current.changeView('markdown');
    });
    act(() => {
      result.current.updateMarkdown('# Discard this');
    });
    expect(result.current.dirty).toBe(true);
    act(() => {
      result.current.discardMarkdown();
    });
    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.changeView('markdown');
    });
    act(() => {
      result.current.updateMarkdown('# Save this');
    });
    act(() => {
      result.current.saveDocument('json');
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.document.children[0]).toMatchObject({
      content: [{ text: 'Save this' }],
    });
  });

  it('requires confirmation before deleting a chapter and prevents deleting the final chapter', async () => {
    const { result } = await workspace();
    const first = result.current.projectSession!.activeChapterId;
    act(() => {
      result.current.projectActions.deleteChapter(first);
    });
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.projectActions.addChapter();
    });
    const second = result.current.projectSession!.activeChapterId;
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      result.current.projectActions.deleteChapter(second);
    });
    expect(result.current.project!.chapters).toHaveLength(2);
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => {
      result.current.projectActions.deleteChapter(second);
    });
    expect(result.current.project!.chapters).toHaveLength(1);
    expect(result.current.projectSession!.activeChapterId).toBe(first);
    expect(result.current.editor!.getText()).toContain('First');
  });

  it('does not replace unsaved projects without confirmation', async () => {
    const { result } = await workspace();
    vi.mocked(window.confirm).mockReturnValue(false);
    act(() => {
      result.current.createDocument('slide');
    });
    expect(result.current.project).not.toBeNull();
    await act(async () => {
      await result.current.importFiles([sourceFile('# Replacement')]);
    });
    expect(result.current.project).not.toBeNull();
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => {
      result.current.createDocument('slide');
    });
    expect(result.current.project).toBeNull();
    expect(result.current.document.type).toBe('slide');
  });

  it('cancels late chapter imports after an intervening edit', async () => {
    const { result } = await workspace();
    let resolve!: (value: string) => void;
    const delayed = new Promise<string>((accept) => {
      resolve = accept;
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.projectActions.addChapter([sourceFile(delayed)]);
    });
    act(() => {
      result.current.editor!.commands.insertContent('Keep this edit');
    });
    await act(async () => {
      resolve('# Late chapter');
      await pending;
    });
    expect(result.current.project!.chapters).toHaveLength(1);
    expect(result.current.editor!.getText()).toContain('Keep this edit');
    expect(result.current.projectActions.busy).toBe(false);
  });

  it('does not download or clear dirty state after an edit during ZIP export', async () => {
    const { result } = await workspace();
    let resolve!: (value: Uint8Array) => void;
    vi.spyOn(archive, 'writeReportProject').mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.projectActions.saveProject();
    });
    await waitFor(() => expect(archive.writeReportProject).toHaveBeenCalled());
    act(() => {
      result.current.editor!.commands.insertContent('Newer edit');
    });
    await act(async () => {
      resolve(new Uint8Array());
      await pending;
    });
    expect(files.downloadFile).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    expect(result.current.projectActions.busy).toBe(false);
  });

  it('releases assets for an abandoned project import after unmount', async () => {
    const { result, unmount } = await workspace();
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, { revokeObjectURL: revoke }),
    );
    let resolve!: (value: archive.ImportedProject) => void;
    vi.spyOn(archive, 'readReportProject').mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.projectActions.openProject(
        new File([], 'late.zip'),
      );
    });
    await waitFor(() => expect(archive.readReportProject).toHaveBeenCalled());
    unmount();
    await act(async () => {
      resolve({
        project: createReportProject(parseMarkdown('# Late').document),
        assets: new Map([['image.png', 'blob:late']]),
        diagnostics: [],
      });
      await pending;
    });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:late');
  });
});
