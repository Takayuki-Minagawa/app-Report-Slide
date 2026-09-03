import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { exportSlideHtml } from '@/src/export/slide-html';
import { downloadFile } from '@/src/workspace/files';
import { useDocumentWorkspace } from './use-document-workspace';

vi.mock('@/src/export/slide-html', () => ({ exportSlideHtml: vi.fn() }));
vi.mock('@/src/workspace/files', async (original) => ({
  ...(await original<typeof import('@/src/workspace/files')>()),
  downloadFile: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AppPreferencesProvider>{children}</AppPreferencesProvider>;
}
async function workspace() {
  const hook = renderHook(useDocumentWorkspace, { wrapper });
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  act(() => hook.result.current.createDocument('slide'));
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  return hook;
}
const exported = { html: '<!doctype html><html></html>', externalImages: [] };

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportSlideHtml).mockReset().mockResolvedValue(exported);
  vi.mocked(downloadFile).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('workspace HTML export', () => {
  it('exports the latest editor snapshot without clearing dirty state or Undo', async () => {
    const { result } = await workspace();
    act(() => {
      result.current.editor!.commands.insertContent('Latest edit');
    });
    const source = result.current.document;
    const editor = result.current.editor;
    const undoAvailable = editor!.can().undo();
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(exportSlideHtml).toHaveBeenCalledWith(source, expect.any(Map), 'ja');
    expect(downloadFile).toHaveBeenCalledWith(
      source,
      'html',
      exported.html,
      'text/html;charset=utf-8',
    );
    expect(result.current.document).toEqual(source);
    expect(result.current.editor).toBe(editor);
    expect(result.current.editor!.can().undo()).toBe(undoAvailable);
    expect(result.current.dirty).toBe(true);
    expect(result.current.htmlExporting).toBe(false);
    expect(result.current.displayedStatus.title).toBe(
      'HTMLスライドを出力しました',
    );
  });

  it('exports an unapplied Markdown snapshot while preserving the draft and previous document', async () => {
    const { result } = await workspace();
    const original = result.current.document;
    const draft = '---\ntype: slide\ntitle: Unapplied\n---\n\n# Draft slide';
    act(() => result.current.changeView('markdown'));
    act(() => result.current.updateMarkdown(draft));
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(vi.mocked(exportSlideHtml).mock.calls[0][0].metadata.title).toBe(
      'Unapplied',
    );
    expect(result.current.document).toEqual(original);
    expect(result.current.markdownDraft).toBe(draft);
    expect(result.current.documentWriteLocked).toBe(true);
    expect(result.current.dirty).toBe(true);
  });

  it.each(['book', 'report'])(
    'rejects a %s Markdown draft without downloading or applying it',
    async (type) => {
      const { result } = await workspace();
      const original = result.current.document;
      act(() => result.current.changeView('markdown'));
      act(() =>
        result.current.updateMarkdown(
          '---\ntype: ' + type + '\n---\n\n# Invalid slide',
        ),
      );
      await act(async () => {
        await result.current.exportHtml();
      });
      expect(exportSlideHtml).not.toHaveBeenCalled();
      expect(downloadFile).not.toHaveBeenCalled();
      expect(result.current.document).toEqual(original);
      expect(result.current.dirty).toBe(true);
      expect(result.current.displayedStatus.kind).toBe('error');
      expect(result.current.htmlExporting).toBe(false);
    },
  );

  it.each(['success', 'failure'] as const)(
    'discards a stale %s after another edit, and prevents concurrent exports',
    async (outcome) => {
      let resolve!: (value: typeof exported) => void;
      let reject!: (reason: Error) => void;
      vi.mocked(exportSlideHtml).mockReturnValue(
        new Promise((accept, decline) => {
          resolve = accept;
          reject = decline;
        }),
      );
      const { result } = await workspace();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.exportHtml();
      });
      await waitFor(() => expect(exportSlideHtml).toHaveBeenCalledTimes(1));
      expect(result.current.htmlExporting).toBe(true);
      await act(async () => {
        await result.current.exportHtml();
      });
      expect(exportSlideHtml).toHaveBeenCalledTimes(1);
      act(() => {
        result.current.editor!.commands.insertContent('Newer edit');
      });
      const newerStatus = result.current.displayedStatus;
      await act(async () => {
        if (outcome === 'success') resolve(exported);
        else reject(new Error('Late failure'));
        await pending;
      });
      expect(downloadFile).not.toHaveBeenCalled();
      expect(result.current.displayedStatus).toEqual(newerStatus);
      expect(JSON.stringify(result.current.document)).toContain('Newer edit');
      expect(result.current.htmlExporting).toBe(false);
    },
  );

  it('ends the progress message when metadata changes cancel an export', async () => {
    let resolve!: (value: typeof exported) => void;
    vi.mocked(exportSlideHtml).mockReturnValue(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    const { result } = await workspace();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.exportHtml();
    });
    await waitFor(() => expect(exportSlideHtml).toHaveBeenCalledTimes(1));
    act(() => result.current.updateDocumentFlag('slide_number', false));
    await act(async () => {
      resolve(exported);
      await pending;
    });
    expect(downloadFile).not.toHaveBeenCalled();
    expect(result.current.htmlExporting).toBe(false);
    expect(result.current.displayedStatus.title).toContain(
      'HTML出力を中止しました',
    );
    expect(result.current.document.metadata.slide_number).toBe(false);
  });

  it('discards a pending export after unmount', async () => {
    let resolve!: (value: typeof exported) => void;
    vi.mocked(exportSlideHtml).mockReturnValue(
      new Promise((accept) => {
        resolve = accept;
      }),
    );
    const { result, unmount } = await workspace();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.exportHtml();
    });
    await waitFor(() => expect(exportSlideHtml).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolve(exported);
      await pending;
    });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('passes the selected UI language and reports external images in that language', async () => {
    window.localStorage.setItem('kumi.locale', 'en');
    vi.mocked(exportSlideHtml).mockResolvedValue({
      ...exported,
      externalImages: ['https://example.com/chart.png'],
    });
    const { result } = await workspace();
    await act(async () => {
      await result.current.exportHtml();
    });
    expect(exportSlideHtml).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Map),
      'en',
    );
    expect(result.current.displayedStatus.title).toBe('Exported HTML slides');
    expect(result.current.displayedStatus.description).toContain(
      'External image URLs',
    );
  });
});
