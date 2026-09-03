import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultDocument, type DocumentData } from '@/src/document/model';
import {
  createInsertedImageAsset,
  createLocalAssetUrls,
  readWorkspaceFiles,
  revokeAssetUrls,
} from './files';
import { WorkspaceStatusError } from './status';

function withImages(sources: string[]): DocumentData {
  return {
    schemaVersion: 2,
    type: 'report',
    metadata: {},
    children: sources.map((src, index) => ({
      type: 'figure',
      attrs: {
        nodeId: 'image-' + index,
        src,
        alt: '',
        title: null,
        width: 100,
        align: 'center',
      },
    })),
  };
}

function sourceFile(
  name: string,
  content: string,
  type = 'text/markdown',
): File {
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn().mockResolvedValue(content),
  });
  return file;
}

const createUrl = vi.fn<(file: Blob) => string>();
const revokeUrl = vi.fn<(url: string) => void>();

beforeEach(() => {
  let sequence = 0;
  createUrl.mockReset().mockImplementation(() => 'blob:local-' + ++sequence);
  revokeUrl.mockReset();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('local document assets', () => {
  it.each(['constructor', '__proto__', 'toString'])(
    'handles the ordinary filename %s without prototype collisions',
    (name) => {
      const document = withImages([name]);
      const missing = createLocalAssetUrls(document, []);
      expect(missing.urls.get(name)).toBeUndefined();
      expect(missing.unresolved).toEqual([name]);
      const asset = new File(['image'], name, { type: 'image/png' });
      const result = createLocalAssetUrls(document, [asset]);
      expect(result.urls.get(name)).toBe('blob:local-1');
      revokeAssetUrls(result.urls);
      expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:local-1');
    },
  );

  it('shares one URL across normalized aliases and revokes it only once', () => {
    const sources = [
      'assets/my%20chart.png?raw=1',
      'my%20chart.png#plot',
      '  assets/my%20chart.png  ',
    ];
    const result = createLocalAssetUrls(withImages(sources), [
      new File(['image'], 'my chart.png', { type: 'image/png' }),
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.urls.size).toBe(3);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(result.urls.get(sources[2].trim())).toBe('blob:local-1');
    revokeAssetUrls(result.urls);
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it('releases partial allocations if a later asset cannot be opened', () => {
    createUrl
      .mockImplementationOnce(() => 'blob:first')
      .mockImplementationOnce(() => {
        throw new Error('object URL allocation failed');
      });
    expect(() =>
      createLocalAssetUrls(withImages(['a.png', 'b.png']), [
        new File(['a'], 'a.png'),
        new File(['b'], 'b.png'),
      ]),
    ).toThrow('object URL allocation failed');
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:first');
  });

  it('does not choose ambiguous filenames or treat absolute URLs as local attachments', () => {
    const result = createLocalAssetUrls(
      withImages([
        'same.png',
        'missing.png',
        ' https://example.com/image.png ',
        '/public/image.png',
      ]),
      [new File(['a'], 'same.png'), new File(['b'], 'same.png')],
    );
    expect(result.unresolved).toEqual(['same.png', 'missing.png']);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('finds inline images in nested content using the same traversal', () => {
    const document: DocumentData = {
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'blockquote',
          attrs: { nodeId: 'quote' },
          content: [
            {
              type: 'paragraph',
              attrs: { nodeId: 'p' },
              content: [
                {
                  type: 'inlineImage',
                  attrs: {
                    nodeId: 'inline',
                    src: 'chart.png',
                    alt: '',
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      createLocalAssetUrls(document, [new File(['a'], 'chart.png')]).urls.get(
        'chart.png',
      ),
    ).toBe('blob:local-1');
  });
});

describe('workspace file import', () => {
  const markdown = '---\ntype: report\ntitle: From Markdown\n---\n\n# Body';

  it('accepts application/json without requiring a filename extension', async () => {
    const document = {
      ...createDefaultDocument('report'),
      metadata: { title: 'From JSON' },
    };
    const result = await readWorkspaceFiles([
      sourceFile('document', JSON.stringify(document), 'application/json'),
    ]);
    expect(result.document.metadata.title).toBe('From JSON');
    expect(result.diagnostics).toEqual([]);
  });

  it('uses explicit extensions before potentially incorrect MIME types', async () => {
    const md = await readWorkspaceFiles([
      sourceFile('report.md', markdown, 'application/json'),
    ]);
    expect(md.document.metadata.title).toBe('From Markdown');
    const json = await readWorkspaceFiles([
      sourceFile(
        'report.json',
        JSON.stringify(createDefaultDocument('report')),
      ),
    ]);
    expect(json.document.schemaVersion).toBe(2);
  });

  it('rejects multiple sources and unsupported attachments before allocating assets', async () => {
    const source = sourceFile('report.md', markdown);
    const readSource = vi.spyOn(source, 'text');
    await expect(
      readWorkspaceFiles([source, sourceFile('other.md', markdown)]),
    ).rejects.toMatchObject({ status: { key: 'selectOneSource' } });
    await expect(
      readWorkspaceFiles([source, new File(['x'], 'program.exe')]),
    ).rejects.toBeInstanceOf(WorkspaceStatusError);
    expect(readSource).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['source', 'markdownTooLarge'],
    ['asset', 'imageTooLarge'],
    ['total', 'imagesTooLarge'],
  ] as const)(
    'enforces the %s size limit before reading the source',
    async (kind, key) => {
      const source = sourceFile('report.md', markdown);
      const readSource = vi.spyOn(source, 'text');
      const assets = Array.from(
        { length: kind === 'total' ? 3 : 1 },
        (_, index) =>
          new File(['x'], 'asset-' + index + '.png', { type: 'image/png' }),
      );
      if (kind === 'source')
        Object.defineProperty(source, 'size', { value: 5 * 1024 * 1024 + 1 });
      else
        for (const asset of assets)
          Object.defineProperty(asset, 'size', {
            value: kind === 'total' ? 20 * 1024 * 1024 : 20 * 1024 * 1024 + 1,
          });
      await expect(
        readWorkspaceFiles([source, ...assets]),
      ).rejects.toMatchObject({ status: { key } });
      expect(readSource).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();
    },
  );
  describe('slide placement image assets', () => {
    it('keeps same-named selections independent while retaining a re-importable filename', () => {
      const file = new File(['image'], 'cover diagram(1).png', {
        type: 'image/png',
      });
      const first = createInsertedImageAsset(file, new Map());
      const second = createInsertedImageAsset(
        file,
        new Map([[first.source, first.url]]),
        new Set([first.source]),
      );

      expect(first.source).toMatch(
        /^assets\/placed-image-\d+\/cover%20diagram%281%29\.png$/,
      );
      expect(second.source).toMatch(
        /^assets\/placed-image-\d+\/cover%20diagram%281%29\.png$/,
      );
      expect(second.source).not.toBe(first.source);
      const reimported = createLocalAssetUrls(withImages([first.source]), [
        file,
      ]);
      expect(reimported.unresolved).toEqual([]);
      expect(reimported.urls.get(first.source)).toBeDefined();

      revokeAssetUrls(
        new Map([
          [first.source, first.url],
          [second.source, second.url],
        ]),
      );
      revokeAssetUrls(reimported.urls);
      expect(revokeUrl).toHaveBeenCalledTimes(3);
    });

    it('enforces the remaining total image budget before creating an object URL', () => {
      const file = new File(['image'], 'large.png', { type: 'image/png' });
      Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 });

      let error: unknown;
      try {
        createInsertedImageAsset(file, new Map(), new Set(), 36 * 1024 * 1024);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ status: { key: 'imagesTooLarge' } });
      expect(createUrl).not.toHaveBeenCalled();
    });
  });
});
