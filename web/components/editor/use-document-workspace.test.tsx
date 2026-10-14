import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppPreferencesProvider } from '@/components/app-preferences';
import type { FigureNode } from '@/src/document/model';
import type { ExtractionResult } from '@/src/document/extraction';
import type { PdfFigureImport } from './pdf-import-dialog';
import { useDocumentWorkspace } from './use-document-workspace';
import { exportSlideHtml } from '@/src/export/slide-html';
import { writeDocumentArchive } from '@/src/workspace/document-archive';

function wrapper({ children }: { children: ReactNode }) {
  return <AppPreferencesProvider>{children}</AppPreferencesProvider>;
}

function markdown(title: string): string {
  return '---\ntype: report\ntitle: ' + title + '\n---\n\n# ' + title;
}

function sourceFile(name: string, source: string | Promise<string>): File {
  const file = new File([], name, { type: 'text/markdown' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
  return file;
}

function deferredSource() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { file: sourceFile('slow.md', promise), resolve, reject };
}

async function workspace() {
  const hook = renderHook(useDocumentWorkspace, { wrapper });
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  return hook;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('PDF figure updates', () => {
  it.each(['report', 'slide'] as const)(
    '%s keeps reviewed evidence for a DPI update and removes it for a different region',
    async (type) => {
      let serial = 0;
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => `blob:pdf-update-${++serial}`,
          revokeObjectURL: vi.fn(),
        }),
      );
      const { result, unmount } = await workspace();
      if (type === 'slide') act(() => result.current.createDocument('slide'));
      const bytes = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');
      const pdf = new File([bytes], 'inspection.pdf', {
        type: 'application/pdf',
      });
      Object.defineProperty(pdf, 'arrayBuffer', {
        value: async () => bytes.buffer,
      });
      const evidence: ExtractionResult = {
        mode: 'table',
        method: 'ocr',
        text: 'Sample\tValue\nA\t12.5',
        rawText: 'Sample\tValue\nA\tl2.5',
        rows: [
          ['Sample', 'Value'],
          ['A', '12.5'],
        ],
        rawRows: [
          ['Sample', 'Value'],
          ['A', 'l2.5'],
        ],
        numericValues: [
          [null, null],
          [null, 12.5],
        ],
        header: true,
        language: 'eng',
        confidence: 87,
        warnings: [],
      };
      const value: PdfFigureImport = {
        pdf,
        image: new File(['page image'], 'page.png', { type: 'image/png' }),
        fileName: pdf.name,
        page: 2,
        pageCount: 3,
        dpi: 144,
        imageSize: { width: 800, height: 1000 },
        crop: { x: 10, y: 20, width: 70, height: 50 },
        reference: {
          id: 'inspection',
          title: 'Inspection',
          authors: '',
          year: '',
          url: '',
        },
        printedPage: '12',
        figureNumber: 'Table 1',
        target: 'after-block',
        extraction: evidence,
      };
      await act(async () => result.current.applyPdfFigure(value));
      const selectedFigure = () =>
        result.current.document.children.find(
          (node): node is FigureNode => node.type === 'figure',
        )!;
      const original = selectedFigure();
      const originalTable = result.current.document.children.find(
        (node) => node.type === 'table',
      );
      expect(original.attrs.figureEdit?.extraction).toEqual(evidence);
      expect(originalTable).toBeDefined();

      const update: PdfFigureImport = {
        ...value,
        existingAsset: original.attrs.figureEdit!.pdfSource!.asset,
        replaceNodeId: original.attrs.nodeId,
        extraction: undefined,
        dpi: 288,
        imageSize: { width: 1600, height: 2000 },
        image: new File(['higher resolution page'], 'page-288.png', {
          type: 'image/png',
        }),
        crop: { ...value.crop },
      };
      await act(async () => result.current.applyPdfFigure(update));
      expect(selectedFigure().attrs.figureEdit?.pdfSource).toMatchObject({
        asset: update.existingAsset,
        page: 2,
        dpi: 288,
      });
      expect(selectedFigure().attrs.figureEdit?.extraction).toEqual(evidence);
      expect(selectedFigure().attrs.src).not.toBe(original.attrs.src);
      expect(
        result.current.document.children.filter(
          (node) => node.type === 'table',
        ),
      ).toEqual([originalTable]);

      await act(async () =>
        result.current.applyPdfFigure({
          ...update,
          crop: { ...update.crop, width: 50 },
        }),
      );
      expect(selectedFigure().attrs.figureEdit?.crop?.width).toBe(50);
      expect(selectedFigure().attrs.figureEdit?.extraction).toBeUndefined();
      expect(
        result.current.document.children.filter(
          (node) => node.type === 'table',
        ),
      ).toEqual([originalTable]);
      unmount();
    },
  );
});

describe('asynchronous document import', () => {
  it('previews external HTML without replacing the document until confirmed', async () => {
    const { result } = await workspace();
    const before = result.current.document;
    await act(async () => {
      await result.current.importFiles([
        sourceFile('source.html', '<h1>Imported HTML</h1><p>12.5 mm</p>'),
      ]);
    });
    expect(result.current.document).toEqual(before);
    expect(result.current.pendingHtmlImport?.htmlImport?.kind).toBe(
      'converted',
    );
    act(() => result.current.confirmHtmlImport());
    expect(result.current.document.metadata.title).toBe('Imported HTML');
    expect(result.current.pendingHtmlImport).toBeNull();
  });

  it('does not apply an HTML preview after a newer document change', async () => {
    const { result } = await workspace();
    await act(async () => {
      await result.current.importFiles([
        sourceFile('source.html', '<h1>Stale HTML</h1>'),
      ]);
    });
    act(() => result.current.createDocument('slide'));
    act(() => result.current.confirmHtmlImport());
    expect(result.current.document.type).toBe('slide');
    expect(result.current.document.metadata.title).not.toBe('Stale HTML');
    expect(result.current.pendingHtmlImport).toBeNull();
  });

  it('removes optional design metadata when undo restores the unset state', async () => {
    const { result } = await workspace();
    act(() =>
      result.current.updateMetadata({
        slide_design: { version: 1, pages: [] },
      }),
    );
    act(() => result.current.updateMetadata({ slide_design: undefined }));
    expect(result.current.document.metadata).not.toHaveProperty('slide_design');
  });
  it('confirms before replacing a dirty single document', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { result } = await workspace();

    act(() => {
      result.current.editor!.commands.insertContent('Unsaved single document');
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));
    act(() => result.current.createDocument('slide'));

    expect(confirm).toHaveBeenCalledOnce();
    expect(result.current.document.type).toBe('report');
  });

  it('keeps an applied Markdown edit unsaved until it is exported', async () => {
    const { result } = await workspace();
    const draft = markdown('Applied draft');

    act(() => result.current.changeView('markdown'));
    await waitFor(() => expect(result.current.view).toBe('markdown'));
    act(() => result.current.updateMarkdown(draft));
    await waitFor(() => expect(result.current.markdownDraft).toBe(draft));
    act(() => result.current.applyMarkdown());

    await waitFor(() =>
      expect(result.current.document.metadata.title).toBe('Applied draft'),
    );
    expect(result.current.dirty).toBe(true);
  });

  it('releases assets even if multiple imports complete in one React batch', async () => {
    let sequence = 0;
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => 'blob:asset-' + ++sequence,
        revokeObjectURL: revokeUrl,
      }),
    );
    const { result, unmount } = await workspace();
    await act(async () => {
      await result.current.importFiles([
        sourceFile('first.md', markdown('First') + '\n\n![A](a.png)'),
        new File(['a'], 'a.png', { type: 'image/png' }),
      ]);
      await result.current.importFiles([
        sourceFile('second.md', markdown('Second') + '\n\n![B](b.png)'),
        new File(['b'], 'b.png', { type: 'image/png' }),
      ]);
    });
    expect(result.current.document.metadata.title).toBe('Second');
    expect(result.current.resolveImageUrl('b.png')).toBe('blob:asset-2');
    const revokedAfterReplacement = revokeUrl.mock.calls.map(([url]) => url);
    unmount();
    expect(revokedAfterReplacement).toEqual(['blob:asset-1']);
    expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
      'blob:asset-1',
      'blob:asset-2',
    ]);
  });
  it.each(['success', 'error'] as const)(
    'does not overwrite a newer import with a late %s',
    async (outcome) => {
      const { result } = await workspace();
      const slow = deferredSource();
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.importFiles([slow.file]);
      });
      await act(async () => {
        await result.current.importFiles([
          sourceFile('new.md', markdown('New document')),
        ]);
      });
      const newerStatus = result.current.displayedStatus;
      await act(async () => {
        if (outcome === 'success') slow.resolve(markdown('Old document'));
        else slow.reject(new Error('Late read failure'));
        await pending;
      });
      expect(result.current.document.metadata.title).toBe('New document');
      expect(result.current.displayedStatus).toEqual(newerStatus);
    },
  );

  it('preserves an edit made while a file is reading', async () => {
    const { result } = await workspace();
    const slow = deferredSource();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFiles([slow.file]);
    });
    act(() => {
      result.current.editor!.commands.insertContent('Local edit');
    });
    const edited = result.current.document;
    await act(async () => {
      slow.resolve(markdown('Slow document'));
      await pending;
    });
    expect(result.current.document).toEqual(edited);
    expect(JSON.stringify(result.current.document)).toContain('Local edit');
    expect(result.current.dirty).toBe(true);
  });

  it('preserves a Markdown draft made while a file is reading', async () => {
    const { result } = await workspace();
    const slow = deferredSource();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFiles([slow.file]);
    });
    const draft = markdown('Unapplied draft');
    act(() => {
      result.current.changeView('markdown');
      result.current.updateMarkdown(draft);
    });
    await act(async () => {
      slow.resolve(markdown('Slow document'));
      await pending;
    });
    expect(result.current.markdownDraft).toBe(draft);
    expect(result.current.document.metadata.title).not.toBe('Slow document');
    expect(result.current.documentWriteLocked).toBe(true);
  });

  it('preserves metadata changed while a file is reading', async () => {
    const { result } = await workspace();
    const slow = deferredSource();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFiles([slow.file]);
    });
    act(() => {
      result.current.updateDocumentFlag('toc', true);
    });
    await act(async () => {
      slow.resolve(markdown('Slow document'));
      await pending;
    });
    expect(result.current.document.metadata.toc).toBe(true);
    expect(result.current.document.metadata.title).not.toBe('Slow document');
  });

  it('discards and releases an imported image after the user creates a new document', async () => {
    const createUrl = vi.fn(() => 'blob:abandoned');
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: createUrl,
        revokeObjectURL: revokeUrl,
      }),
    );
    const { result, unmount } = await workspace();
    const slow = deferredSource();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFiles([
        slow.file,
        new File(['image'], 'chart.png', { type: 'image/png' }),
      ]);
    });
    act(() => {
      result.current.createDocument('slide');
    });
    await act(async () => {
      slow.resolve(markdown('Slow document') + '\n\n![Chart](chart.png)');
      await pending;
    });
    expect(result.current.document.type).toBe('slide');
    expect(result.current.resolveImageUrl('chart.png')).toBe('chart.png');
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:abandoned');
    unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it('releases assets when a read completes after the workspace is unmounted', async () => {
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => 'blob:unmounted',
        revokeObjectURL: revokeUrl,
      }),
    );
    const { result, unmount } = await workspace();
    const slow = deferredSource();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importFiles([
        slow.file,
        new File(['image'], 'chart.png', { type: 'image/png' }),
      ]);
    });
    unmount();
    await act(async () => {
      slow.resolve(markdown('Slow document') + '\n\n![Chart](chart.png)');
      await pending;
    });
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:unmounted');
  });
  describe('slide image insertion', () => {
    it('keeps same-named local images independent with default free-placement rectangles', async () => {
      const revokeUrl = vi.fn();
      let sequence = 0;
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => 'blob:placed-' + ++sequence,
          revokeObjectURL: revokeUrl,
        }),
      );
      const { result, unmount } = await workspace();

      act(() => result.current.createDocument('slide'));
      await waitFor(() => expect(result.current.document.type).toBe('slide'));
      act(() =>
        result.current.insertSlideImage(
          new File(['first'], 'architecture.png', { type: 'image/png' }),
          0,
        ),
      );
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(1),
      );

      act(() =>
        result.current.insertSlideImage(
          new File(['second'], 'architecture.png', { type: 'image/png' }),
          0,
        ),
      );
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(2),
      );

      const figures = result.current.document.children.filter(
        (
          node,
        ): node is Extract<
          (typeof result.current.document.children)[number],
          { type: 'figure' }
        > => node.type === 'figure',
      );
      expect(figures[0].attrs).toMatchObject({
        alt: 'architecture',
        slidePlacement: { x: 32, y: 22, width: 36, height: 42 },
      });
      expect(figures[0].attrs.src).toMatch(
        /^assets\/placed-image-\d+\/architecture\.png$/,
      );
      expect(figures[1].attrs.src).toMatch(
        /^assets\/placed-image-\d+\/architecture\.png$/,
      );
      expect(figures[1].attrs.src).not.toBe(figures[0].attrs.src);
      expect(result.current.resolveImageUrl(figures[0].attrs.src)).toBe(
        'blob:placed-1',
      );
      expect(result.current.resolveImageUrl(figures[1].attrs.src)).toBe(
        'blob:placed-2',
      );

      unmount();
      expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
        'blob:placed-1',
        'blob:placed-2',
      ]);
    });

    it('uses pageBreak boundaries when inserting into a selected Slide page', async () => {
      const revokeUrl = vi.fn();
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => 'blob:page-break',
          revokeObjectURL: revokeUrl,
        }),
      );
      const { result, unmount } = await workspace();
      const source = [
        '---',
        'type: slide',
        'title: Page break insertion',
        '---',
        '',
        '# First',
        '',
        '::: pagebreak',
        ':::',
        '',
        '# Second',
        '',
        '::: pagebreak',
        ':::',
        '',
        '# Third',
      ].join('\n');

      act(() => result.current.changeView('markdown'));
      await waitFor(() => expect(result.current.view).toBe('markdown'));
      act(() => result.current.updateMarkdown(source));
      act(() => result.current.applyMarkdown());
      await waitFor(() => expect(result.current.document.type).toBe('slide'));
      act(() =>
        result.current.insertSlideImage(
          new File(['image'], 'middle.png', { type: 'image/png' }),
          1,
        ),
      );
      await waitFor(() =>
        expect(
          result.current.document.children.some(
            (node) => node.type === 'figure',
          ),
        ).toBe(true),
      );

      const figureIndex = result.current.document.children.findIndex(
        (node) => node.type === 'figure',
      );
      const breakIndexes = result.current.document.children
        .map((node, index) => (node.type === 'pageBreak' ? index : -1))
        .filter((index) => index >= 0);
      expect(breakIndexes).toHaveLength(2);
      expect(figureIndex).toBeGreaterThan(breakIndexes[0]);
      expect(figureIndex).toBeLessThan(breakIndexes[1]);

      unmount();
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:page-break');
    });

    it('rejects an image that would exceed the total local-asset budget', async () => {
      let sequence = 0;
      const createUrl = vi.fn(() => 'blob:budget-' + ++sequence);
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: createUrl,
          revokeObjectURL: vi.fn(),
        }),
      );
      const { result } = await workspace();
      const image = (name: string) => {
        const file = new File(['image'], name, { type: 'image/png' });
        Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
        return file;
      };

      act(() => result.current.createDocument('slide'));
      await waitFor(() => expect(result.current.document.type).toBe('slide'));
      act(() => result.current.insertSlideImage(image('one.png'), 0));
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(1),
      );
      act(() => result.current.insertSlideImage(image('two.png'), 0));
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(2),
      );
      act(() => result.current.insertSlideImage(image('three.png'), 0));

      await waitFor(() =>
        expect(result.current.displayedStatus.kind).toBe('error'),
      );
      expect(
        result.current.document.children.filter(
          (node) => node.type === 'figure',
        ),
      ).toHaveLength(2);
      expect(createUrl).toHaveBeenCalledTimes(2);
    });

    it('reclaims the image budget after visual edits remove placed images', async () => {
      let sequence = 0;
      const revokeUrl = vi.fn();
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => 'blob:reclaim-' + ++sequence,
          revokeObjectURL: revokeUrl,
        }),
      );
      const { result, unmount } = await workspace();
      const image = (name: string) => {
        const file = new File(['image'], name, { type: 'image/png' });
        Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
        return file;
      };

      act(() => result.current.createDocument('slide'));
      await waitFor(() => expect(result.current.document.type).toBe('slide'));
      act(() => result.current.insertSlideImage(image('first.png'), 0));
      act(() => result.current.insertSlideImage(image('second.png'), 0));
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(2),
      );

      act(() => void result.current.editor!.commands.clearContent());
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(0),
      );
      expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
        'blob:reclaim-1',
        'blob:reclaim-2',
      ]);

      act(() => result.current.insertSlideImage(image('replacement.png'), 0));
      await waitFor(() =>
        expect(
          result.current.document.children.filter(
            (node) => node.type === 'figure',
          ),
        ).toHaveLength(1),
      );
      expect(sequence).toBe(3);

      unmount();
      expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
        'blob:reclaim-1',
        'blob:reclaim-2',
        'blob:reclaim-3',
      ]);
    });
  });
});

describe('normal image insertion', () => {
  it.each(['report', 'slide'] as const)(
    'inserts PNG/JPEG/WebP after a block in %s and preserves assets through Undo/Redo',
    async (type) => {
      let serial = 0;
      const revokeUrl = vi.fn();
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => `blob:normal-${++serial}`,
          revokeObjectURL: revokeUrl,
        }),
      );
      const { result, unmount } = await workspace();
      act(() => result.current.createDocument(type));
      await waitFor(() => expect(result.current.document.type).toBe(type));
      await act(() =>
        result.current.editor!.commands.setContent({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { nodeId: 'before-image' },
              content: [{ type: 'text', text: '画像の前' }],
            },
            {
              type: 'paragraph',
              attrs: { nodeId: 'after-image' },
              content: [{ type: 'text', text: '画像の後' }],
            },
          ],
        }),
      );
      act(() => result.current.focusNode('before-image'));
      for (const [extension, mime] of [
        ['png', 'image/png'],
        ['jpg', 'image/jpeg'],
        ['webp', 'image/webp'],
      ]) {
        act(() => {
          expect(
            result.current.insertImage(
              new File(['image'], `sample.${extension}`, { type: mime }),
              'after-block',
            ).ok,
          ).toBe(true);
        });
      }
      const figures = result.current.document.children.filter(
        (node) => node.type === 'figure',
      );
      expect(figures).toHaveLength(3);
      expect(result.current.document.children.map((node) => node.type)).toEqual(
        ['paragraph', 'figure', 'figure', 'figure', 'paragraph'],
      );
      expect(figures.every((node) => !node.attrs.slidePlacement)).toBe(true);
      expect(result.current.selectedNode?.nodeId).toBe(figures[2].attrs.nodeId);
      const source = figures[2].attrs.src;
      expect(result.current.resolveImageUrl(source)).toBe('blob:normal-3');
      act(() => {
        result.current.editor!.commands.undo();
      });
      expect(revokeUrl).not.toHaveBeenCalled();
      act(() => {
        result.current.editor!.commands.redo();
      });
      expect(
        result.current.document.children.some(
          (node) => node.type === 'figure' && node.attrs.src === source,
        ),
      ).toBe(true);
      expect(result.current.resolveImageUrl(source)).toBe('blob:normal-3');
      unmount();
      expect(revokeUrl).toHaveBeenCalledTimes(3);
    },
  );

  it('places figures outside selected table cells and honors the end of the current page', async () => {
    let serial = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => `blob:target-${++serial}`,
        revokeObjectURL: vi.fn(),
      }),
    );
    const { result, unmount } = await workspace();
    await act(async () => {
      await result.current.importFiles([
        sourceFile(
          'table.md',
          markdown('Image target') +
            '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nページ末尾\n\n::: pagebreak\n:::\n\n次ページ',
        ),
      ]);
    });
    const table = result.current.document.children.find(
      (node) => node.type === 'table',
    )!;
    const normalizedTable = result.current
      .editor!.getJSON()
      .content!.find((node) => node.type === 'table');
    let cellPosition = 0;
    result.current.editor!.state.doc.descendants((node, position) => {
      if (!cellPosition && node.type.name === 'tableCell')
        cellPosition = position + 2;
    });
    await act(() =>
      result.current.editor!.commands.setTextSelection(cellPosition),
    );
    act(() => {
      result.current.insertImage(
        new File(['one'], 'after-table.png', { type: 'image/png' }),
        'after-block',
      );
    });
    const tableIndex = result.current.document.children.findIndex(
      (node) => node.attrs.nodeId === table.attrs.nodeId,
    );
    expect(result.current.document.children[tableIndex + 1].type).toBe(
      'figure',
    );
    expect(result.current.document.children[tableIndex + 2].type).toBe(
      'paragraph',
    );
    act(() => {
      result.current.insertImage(
        new File(['two'], 'page-end.png', { type: 'image/png' }),
        'page-end',
      );
    });
    const breakIndex = result.current.document.children.findIndex(
      (node) => node.type === 'pageBreak',
    );
    expect(result.current.document.children[breakIndex - 1]).toMatchObject({
      type: 'figure',
      attrs: { alt: 'page-end' },
    });
    expect(result.current.document.children[tableIndex]).toEqual(
      normalizedTable,
    );
    unmount();
  });

  it('rejects invalid/oversized inputs without changing text and releases assets if insertion is refused', async () => {
    const createUrl = vi.fn(() => 'blob:rejected-image');
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: createUrl,
        revokeObjectURL: revokeUrl,
      }),
    );
    const { result, unmount } = await workspace();
    const before = result.current.document;
    const tooLarge = new File(['image'], 'too-large.png', {
      type: 'image/png',
    });
    Object.defineProperty(tooLarge, 'size', { value: 20 * 1024 * 1024 + 1 });
    act(() => {
      expect(result.current.insertImage(tooLarge, 'after-block')).toMatchObject(
        { ok: false, message: expect.stringContaining('20MB') },
      );
      expect(
        result.current.insertImage(
          new File(['text'], 'notes.txt', { type: 'text/plain' }),
          'after-block',
        ).ok,
      ).toBe(false);
    });
    expect(createUrl).not.toHaveBeenCalled();
    expect(result.current.document).toEqual(before);
    act(() => result.current.editor!.setEditable(false));
    const lockedDocument = result.current.document;
    act(() => {
      expect(
        result.current.insertImage(
          new File(['image'], 'rejected.png', { type: 'image/png' }),
          'after-block',
        ).ok,
      ).toBe(false);
    });
    expect(result.current.document).toEqual(lockedDocument);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:rejected-image');
    unmount();
  });
});

describe('restored image history', () => {
  it.each(['Markdown', 'HTML', 'ZIP'] as const)(
    'keeps a Slide image available to deletion Undo/Redo after %s starts a new editing session',
    async (format) => {
      let serial = 0;
      const revokeUrl = vi.fn();
      vi.stubGlobal(
        'URL',
        Object.assign(class extends URL {}, {
          createObjectURL: () => `blob:restored-history-${++serial}`,
          revokeObjectURL: revokeUrl,
        }),
      );
      vi.stubGlobal('confirm', () => true);
      const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(imageBytes, {
              headers: { 'content-type': 'image/png' },
            }),
        ),
      );
      const { result, unmount } = await workspace();
      act(() => result.current.createDocument('slide'));
      act(() => {
        expect(
          result.current.insertImage(
            new File([imageBytes], 'restored.png', { type: 'image/png' }),
            'after-block',
          ).ok,
        ).toBe(true);
      });
      const original = result.current.document.children.find(
        (node): node is FigureNode => node.type === 'figure',
      )!;
      const assets = new Map([
        [
          original.attrs.src,
          result.current.resolveImageUrl(original.attrs.src),
        ],
      ]);
      if (format === 'Markdown') {
        act(() => result.current.changeView('markdown'));
        act(() =>
          result.current.updateMarkdown(
            result.current.markdownDraft + '\n\nApplied source',
          ),
        );
        act(() => result.current.applyMarkdown());
      } else if (format === 'HTML') {
        const saved = await exportSlideHtml(
          result.current.document,
          assets,
          'ja',
        );
        await act(async () =>
          result.current.importFiles([sourceFile('restored.html', saved.html)]),
        );
        expect(result.current.pendingHtmlImport).not.toBeNull();
        act(() => result.current.confirmHtmlImport());
      } else {
        const bytes = await writeDocumentArchive(
          result.current.document,
          assets,
        );
        const file = new File([Uint8Array.from(bytes).buffer], 'restored.zip', {
          type: 'application/zip',
        });
        Object.defineProperty(file, 'arrayBuffer', {
          value: async () => Uint8Array.from(bytes).buffer,
        });
        await act(async () => result.current.importFiles([file]));
      }
      await waitFor(() => expect(result.current.view).toBe('visual'));
      const figure = result.current.document.children.find(
        (node): node is FigureNode => node.type === 'figure',
      )!;
      const url = result.current.resolveImageUrl(figure.attrs.src);
      expect(url).toMatch(/^blob:restored-history-/);
      act(() => result.current.focusNode(figure.attrs.nodeId));
      act(() => {
        expect(result.current.editor!.commands.deleteSelection()).toBe(true);
      });
      expect(
        result.current.document.children.some((node) => node.type === 'figure'),
      ).toBe(false);
      expect(result.current.resolveImageUrl(figure.attrs.src)).toBe(url);
      expect(revokeUrl).not.toHaveBeenCalledWith(url);
      act(() => {
        expect(result.current.editor!.commands.undo()).toBe(true);
      });
      expect(
        result.current.document.children.find(
          (node) => node.attrs.nodeId === figure.attrs.nodeId,
        ),
      ).toMatchObject(figure);
      expect(result.current.resolveImageUrl(figure.attrs.src)).toBe(url);
      act(() => {
        expect(result.current.editor!.commands.redo()).toBe(true);
      });
      expect(
        result.current.document.children.some((node) => node.type === 'figure'),
      ).toBe(false);
      expect(revokeUrl).not.toHaveBeenCalledWith(url);
      act(() => result.current.createDocument('slide'));
      expect(revokeUrl).toHaveBeenCalledWith(url);
      unmount();
      expect(
        revokeUrl.mock.calls.filter(([revoked]) => revoked === url),
      ).toHaveLength(1);
    },
  );

  it('counts retained Undo images in the 50 MB limit and releases them when an empty source replaces the history', async () => {
    let serial = 0;
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => `blob:retained-budget-${++serial}`,
        revokeObjectURL: revokeUrl,
      }),
    );
    const { result, unmount } = await workspace();
    const image = (name: string) => {
      const file = new File(['image'], name, { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
      return file;
    };
    act(() => result.current.createDocument('slide'));
    for (const name of ['first.png', 'second.png'])
      act(() => {
        expect(result.current.insertImage(image(name), 'after-block').ok).toBe(
          true,
        );
      });
    act(() => {
      result.current.editor!.commands.clearContent();
    });
    expect(revokeUrl).not.toHaveBeenCalled();
    act(() => {
      expect(
        result.current.insertImage(image('over-budget.png'), 'after-block').ok,
      ).toBe(false);
    });
    act(() => result.current.changeView('markdown'));
    act(() =>
      result.current.updateMarkdown('---\ntype: slide\n---\n\n# Fresh source'),
    );
    act(() => result.current.applyMarkdown());
    expect(revokeUrl.mock.calls.map(([url]) => url)).toEqual([
      'blob:retained-budget-1',
      'blob:retained-budget-2',
    ]);
    act(() => {
      expect(
        result.current.insertImage(image('new-session.png'), 'after-block').ok,
      ).toBe(true);
    });
    expect(serial).toBe(3);
    unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(3);
  });
});
