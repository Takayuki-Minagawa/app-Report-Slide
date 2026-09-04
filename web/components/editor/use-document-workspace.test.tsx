import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { useDocumentWorkspace } from './use-document-workspace';

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

describe('asynchronous document import', () => {
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
