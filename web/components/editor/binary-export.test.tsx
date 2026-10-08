import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { exportReportDocx } from '@/src/export/report-docx';
import { exportSlidePptx } from '@/src/export/slide-pptx';
import { exportDocumentPdf } from '@/src/export/document-pdf';
import { downloadFile } from '@/src/workspace/files';
import { useDocumentWorkspace } from './use-document-workspace';

vi.mock('@/src/export/report-docx', () => ({ exportReportDocx: vi.fn() }));
vi.mock('@/src/export/slide-pptx', () => ({ exportSlidePptx: vi.fn() }));
vi.mock('@/src/export/document-pdf', () => ({ exportDocumentPdf: vi.fn() }));
vi.mock('@/src/workspace/files', async (original) => ({
  ...(await original<typeof import('@/src/workspace/files')>()),
  downloadFile: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AppPreferencesProvider>{children}</AppPreferencesProvider>;
}
async function workspace(type: 'report' | 'slide' = 'report') {
  const hook = renderHook(useDocumentWorkspace, { wrapper });
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  act(() => hook.result.current.createDocument(type));
  return hook;
}
function sourceFile(text: string): File {
  const file = new File([], 'chapter.md', { type: 'text/markdown' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}
const exported = { blob: new Blob(['file']), warnings: ['Conversion detail'] };
beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(downloadFile).mockClear();
  for (const exporter of [
    exportReportDocx,
    exportSlidePptx,
    exportDocumentPdf,
  ]) {
    vi.mocked(exporter).mockReset().mockResolvedValue(exported);
  }
});

describe('Word, PowerPoint and PDF workspace exports', () => {
  it.each([
    ['report', 'office', 'docx', exportReportDocx],
    ['slide', 'office', 'pptx', exportSlidePptx],
    ['report', 'pdf', 'pdf', exportDocumentPdf],
    ['slide', 'pdf', 'pdf', exportDocumentPdf],
  ] as const)(
    'exports %s as %s without marking the source saved',
    async (type, format, extension, exporter) => {
      const { result } = await workspace(type);
      act(() => {
        result.current.editor!.commands.insertContent('Latest edit');
      });
      const source = result.current.document;
      const editor = result.current.editor;
      await act(async () => {
        await (format === 'pdf'
          ? result.current.exportPdf()
          : result.current.exportOffice());
      });
      expect(exporter).toHaveBeenCalledWith(source, expect.any(Map), 'ja');
      expect(downloadFile).toHaveBeenCalledWith(
        source,
        extension,
        exported.blob,
        expect.any(String),
      );
      expect(result.current.document).toEqual(source);
      expect(result.current.editor).toBe(editor);
      expect(editor!.can().undo()).toBe(true);
      expect(result.current.dirty).toBe(true);
      expect(result.current.binaryExporting).toBeNull();
      expect(result.current.displayedStatus.description).toContain(
        'Conversion detail',
      );
    },
  );

  it('uses an unapplied Markdown snapshot and its actual document type', async () => {
    const { result } = await workspace();
    const original = result.current.document;
    const draft = '---\ntype: slide\ntitle: Draft deck\n---\n\n# Unsaved slide';
    act(() => result.current.changeView('markdown'));
    act(() => result.current.updateMarkdown(draft));
    await act(async () => {
      await result.current.exportOffice();
    });
    expect(exportSlidePptx).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'slide',
        metadata: expect.objectContaining({ title: 'Draft deck' }),
      }),
      expect.any(Map),
      'ja',
    );
    expect(result.current.document).toEqual(original);
    expect(result.current.markdownDraft).toBe(draft);
    expect(result.current.dirty).toBe(true);
  });

  it.each(['office', 'pdf'] as const)(
    'exports enabled chapters together as %s with latest active draft',
    async (format) => {
      const { result } = await workspace();
      act(() => result.current.projectActions.createProject());
      await act(async () => {
        await result.current.projectActions.addChapter([
          sourceFile('# Excluded content'),
        ]);
      });
      const excludedId = result.current.projectSession!.activeChapterId;
      act(() =>
        result.current.projectActions.updateChapter(excludedId, {
          enabled: false,
        }),
      );
      await act(async () => {
        await result.current.projectActions.addChapter([
          sourceFile('# Final chapter'),
        ]);
      });
      act(() => result.current.changeView('markdown'));
      act(() => result.current.updateMarkdown('# Latest chapter draft'));
      await act(async () => {
        await (format === 'pdf'
          ? result.current.exportPdf()
          : result.current.exportOffice());
      });
      const exporter = format === 'pdf' ? exportDocumentPdf : exportReportDocx;
      const combined = JSON.stringify(vi.mocked(exporter).mock.calls[0][0]);
      expect(combined).toContain('タイトル');
      expect(combined).toContain('Latest chapter draft');
      expect(combined).not.toContain('Excluded content');
      expect(result.current.dirty).toBe(true);
    },
  );

  it('rejects invalid drafts and reports conversion failures without downloading', async () => {
    const { result } = await workspace();
    act(() => result.current.changeView('markdown'));
    act(() =>
      result.current.updateMarkdown('---\ntype: book\n---\n\n# Invalid'),
    );
    await act(async () => {
      await result.current.exportOffice();
    });
    expect(exportReportDocx).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(result.current.displayedStatus.kind).toBe('error');
    act(() => result.current.updateMarkdown('# Valid'));
    vi.mocked(exportReportDocx).mockRejectedValue(
      new Error('Unreadable image'),
    );
    await act(async () => {
      await result.current.exportOffice();
    });
    expect(result.current.displayedStatus.description).toBe('Unreadable image');
    expect(result.current.binaryExporting).toBeNull();
  });

  it.each(['edit', 'unmount', 'failure'] as const)(
    'discards a pending export after %s and blocks concurrent formats',
    async (event) => {
      let resolve!: (value: typeof exported) => void;
      let reject!: (error: Error) => void;
      vi.mocked(exportReportDocx).mockReturnValue(
        new Promise((accept, decline) => {
          resolve = accept;
          reject = decline;
        }),
      );
      const { result, unmount } = await workspace();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.exportOffice();
      });
      await waitFor(() => expect(exportReportDocx).toHaveBeenCalledTimes(1));
      await act(async () => {
        await result.current.exportOffice();
        await result.current.exportPdf();
        await result.current.exportHtml();
      });
      expect(exportReportDocx).toHaveBeenCalledTimes(1);
      expect(exportDocumentPdf).not.toHaveBeenCalled();
      if (event === 'unmount') unmount();
      else
        act(() => result.current.updateDocumentFlag('number_sections', true));
      await act(async () => {
        if (event === 'failure') reject(new Error('Late failure'));
        else resolve(exported);
        await pending;
      });
      expect(downloadFile).not.toHaveBeenCalled();
      if (event !== 'unmount') {
        expect(result.current.binaryExporting).toBeNull();
        expect(result.current.displayedStatus.title).toContain('出力を中止');
      }
    },
  );
});
