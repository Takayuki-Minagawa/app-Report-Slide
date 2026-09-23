import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { DocumentData } from '@/src/document/model';
import { readDocumentArchive, writeDocumentArchive } from './document-archive';

function file(bytes: Uint8Array): File {
  const result = new File([new Uint8Array(bytes)], 'document.zip', {
    type: 'application/zip',
  });
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  return result;
}

function document(type: 'report' | 'slide'): DocumentData {
  return {
    schemaVersion: 2,
    type,
    metadata: { title: 'With images', toc: true },
    children: ['one/chart.png', 'two/chart.png'].map((src, index) => ({
      type: 'figure',
      attrs: {
        nodeId: `figure-${index}`,
        src,
        alt: `image ${index}`,
        title: null,
        width: 80,
        align: 'center',
        caption: `Figure ${index}`,
        label: `fig:${index}`,
      },
    })),
  };
}

const createUrl = vi.fn();
beforeEach(() => {
  let serial = 0;
  createUrl.mockReset().mockImplementation(() => `blob:loaded-${++serial}`);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: createUrl,
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(url === 'blob:first' ? 'first' : 'second'),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('single document ZIP', () => {
  it.each(['report', 'slide'] as const)(
    'round-trips a %s with same-name images in nested paths',
    async (type) => {
      const source = document(type);
      const bytes = await writeDocumentArchive(
        source,
        new Map([
          ['one/chart.png', 'blob:first'],
          ['two/chart.png', 'blob:second'],
        ]),
      );
      const entries = unzipSync(bytes);
      expect(Object.keys(entries).sort()).toEqual([
        'assets/0001.png',
        'assets/0002.png',
        'document.json',
        'manifest.json',
      ]);
      const loaded = await readDocumentArchive(file(bytes));
      expect(loaded.document).toEqual(source);
      expect([...loaded.assets.keys()]).toEqual([
        'one/chart.png',
        'two/chart.png',
      ]);
      expect(loaded.assets.get('one/chart.png')).not.toBe(
        loaded.assets.get('two/chart.png'),
      );
    },
  );

  it('rejects extra and missing archive entries before creating object URLs', async () => {
    const source = document('report');
    const valid = unzipSync(
      await writeDocumentArchive(
        source,
        new Map([
          ['one/chart.png', 'blob:first'],
          ['two/chart.png', 'blob:second'],
        ]),
      ),
    );
    const extra = zipSync({ ...valid, 'unlisted.txt': strToU8('x') });
    await expect(readDocumentArchive(file(extra))).rejects.toThrow();
    const missing = { ...valid };
    delete missing['assets/0002.png'];
    await expect(readDocumentArchive(file(zipSync(missing)))).rejects.toThrow();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
