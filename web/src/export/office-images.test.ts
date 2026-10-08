import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentData } from '@/src/document/model';
import { prepareOfficeImages } from './office-images';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const pngBytes = Uint8Array.from(atob(png.split(',')[1]), (character) =>
  character.charCodeAt(0),
);
let imageWidth = 80;
let imageHeight = 40;
let decodeFails = false;

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

beforeEach(() => {
  imageWidth = 80;
  imageHeight = 40;
  decodeFails = false;
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = imageWidth;
      naturalHeight = imageHeight;
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        if (value)
          queueMicrotask(() =>
            decodeFails ? this.onerror?.() : this.onload?.(),
          );
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('Office image preparation', () => {
  it('rejects remote URLs before fetching any local or remote image', async () => {
    const source = withImages(['local.png', 'https://example.com/private.png']);
    await expect(
      prepareOfficeImages(source, new Map([['local.png', 'blob:local']]), 'en'),
    ).rejects.toThrow('Import the image as a local file');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports missing local images in Japanese without a network request', async () => {
    await expect(
      prepareOfficeImages(withImages(['missing.png']), new Map(), 'ja'),
    ).rejects.toThrow('画像ファイルを読み込んで');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('decodes embedded PNG bytes and preserves original and normalized keys', async () => {
    const { images } = await prepareOfficeImages(
      withImages(['  ' + png + '  ']),
      new Map(),
      'en',
    );
    expect(images.get(png)).toEqual({
      data: pngBytes,
      dataUrl: png,
      type: 'png',
      width: 80,
      height: 40,
    });
    expect(images.get('  ' + png + '  ')).toBe(images.get(png));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads a workspace blob once for multiple source aliases', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(pngBytes, { headers: { 'content-type': 'image/png' } }),
    );
    const { images } = await prepareOfficeImages(
      withImages(['one.png', 'two.png']),
      new Map([
        ['one.png', 'blob:local'],
        ['two.png', 'blob:local'],
      ]),
      'en',
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith('blob:local');
    expect(images.get('one.png')).toBe(images.get('two.png'));
    expect(images.get('one.png')?.data).toEqual(pngBytes);
  });

  it('does not allow a remote asset mapping to bypass the URL restriction', async () => {
    await expect(
      prepareOfficeImages(
        withImages(['local.png']),
        new Map([['local.png', 'https://example.com/a.png']]),
        'en',
      ),
    ).rejects.toThrow('Import the image file');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports failed decoding without including base64 image data', async () => {
    decodeFails = true;
    const error = await prepareOfficeImages(
      withImages([png]),
      new Map(),
      'en',
    ).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('embedded image');
    expect((error as Error).message).not.toContain('iVBOR');
  });

  it('rejects oversized image dimensions before allocating a canvas', async () => {
    imageWidth = 8193;
    const canvas = vi.spyOn(document, 'createElement');
    await expect(
      prepareOfficeImages(withImages([png]), new Map(), 'en'),
    ).rejects.toThrow('8192');
    expect(canvas).not.toHaveBeenCalledWith('canvas');
  });

  it('normalizes an imported SVG to a PNG and releases the canvas', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"/>',
        { headers: { 'content-type': 'image/svg+xml' } },
      ),
    );
    const context = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
    const { images } = await prepareOfficeImages(
      withImages(['chart.svg']),
      new Map([['chart.svg', 'blob:local']]),
      'ja',
    );
    expect(images.get('chart.svg')).toMatchObject({
      type: 'png',
      data: pngBytes,
      width: 80,
      height: 40,
    });
    expect(context.drawImage).toHaveBeenCalledOnce();
  });
});
