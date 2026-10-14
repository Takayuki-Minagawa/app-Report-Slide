import { webcrypto } from 'node:crypto';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preservedContent } from '@/src/document/preserved-content';
import { exportReportHtml } from '@/src/export/report-html';
import { readWorkspaceFiles } from './files';
import { importHtml } from './html-import';
import { readDocumentArchive, writeDocumentArchive } from './document-archive';

const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  ),
  (character) => character.charCodeAt(0),
);
const blobs = new Map<string, Blob>();
const fetchMock = vi.fn();
let sequence = 0;

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function file(bytes: Uint8Array, name: string, type: string): File {
  const result = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(result, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  Object.defineProperty(result, 'text', {
    value: async () => new TextDecoder().decode(bytes),
  });
  return result;
}

async function assetBytes(assets: ReadonlyMap<string, string>, source: string) {
  const url = assets.get(source);
  expect(url).toBeDefined();
  const blob = blobs.get(url!);
  expect(blob).toBeDefined();
  return new Uint8Array(await readBlob(blob!));
}

beforeEach(() => {
  blobs.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:preserved-asset-${++sequence}`;
        blobs.set(url, blob);
        return url;
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const blob = blobs.get(url);
    if (!blob) throw new Error(`Unexpected asset fetch: ${url}`);
    return new Response(await readBlob(blob), {
      headers: { 'content-type': blob.type },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('unsupported-block image preservation', () => {
  it.each(['?version=1', '#detail'])(
    'retains a sidecar image referenced with %s through editable HTML and ZIP',
    async (suffix) => {
      const source = `assets/plot.png${suffix}`;
      const unsupported = {
        type: 'futureImage',
        attrs: { nodeId: 'future', src: source, futureOption: 'retain me' },
      };
      const imported = await readWorkspaceFiles([
        file(
          new TextEncoder().encode(
            JSON.stringify({
              schemaVersion: 2,
              type: 'report',
              metadata: { title: 'Retained future image' },
              children: [unsupported],
            }),
          ),
          'future.json',
          'application/json',
        ),
        file(png, 'plot.png', 'image/png'),
      ]);
      expect(imported.unresolved).toEqual([]);
      expect(imported.assetBytes).toBe(png.byteLength);
      expect([...imported.assets.keys()]).toEqual([source]);
      const retained = preservedContent(imported.document.metadata);
      expect(retained).toHaveLength(1);
      expect(JSON.parse(retained[0].source)).toEqual(unsupported);
      expect(retained[0].assets).toEqual([{ source, kind: 'image' }]);
      expect(await assetBytes(imported.assets, source)).toEqual(png);

      const html = await exportReportHtml(
        imported.document,
        imported.assets,
        'ja',
      );
      const htmlRestored = importHtml(html.html);
      expect(preservedContent(htmlRestored.document.metadata)).toEqual(
        retained,
      );
      expect(await assetBytes(htmlRestored.assets, source)).toEqual(png);

      const archive = await writeDocumentArchive(
        htmlRestored.document,
        htmlRestored.assets,
      );
      const entries = unzipSync(archive);
      expect(entries['assets/0001.png']).toEqual(png);
      const zipRestored = await readDocumentArchive(
        file(archive, 'retained.zip', 'application/zip'),
      );
      expect(preservedContent(zipRestored.document.metadata)).toEqual(retained);
      expect([...zipRestored.assets.keys()]).toEqual([source]);
      expect(await assetBytes(zipRestored.assets, source)).toEqual(png);
      expect(fetchMock).toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.every(([url]) => String(url).startsWith('blob:')),
      ).toBe(true);
    },
  );
});
