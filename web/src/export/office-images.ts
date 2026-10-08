import type { DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import type { AppLocale } from '@/src/i18n/messages';
import { safeResourceUrl } from '@/src/security/resource-url';
import type { AssetUrls } from '@/src/workspace/files';
import { bytesToBase64 } from './embedded-images';

export interface OfficeImage {
  data: Uint8Array;
  dataUrl: string;
  width: number;
  height: number;
  type: 'png' | 'jpg' | 'gif';
}

const maximumImageBytes = 20 * 1024 * 1024;
const maximumImageDimension = 8192;
const maximumImagePixels = 16 * 1024 * 1024;
type ImageType = OfficeImage['type'] | 'svg' | 'webp';

function imageType(mime: string): ImageType | undefined {
  switch (mime.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
  }
}

function mimeFor(type: ImageType): string {
  return (
    'image/' + (type === 'jpg' ? 'jpeg' : type === 'svg' ? 'svg+xml' : type)
  );
}

function dataUrlFor(data: Uint8Array, type: ImageType): string {
  return `data:${mimeFor(type)};base64,${bytesToBase64(data)}`;
}

function readDataUrl(source: string): { data: Uint8Array; type: ImageType } {
  const match =
    /^data:(image\/[a-z+]+)(?:;charset=[\w-]+)?(;base64)?,([\s\S]*)$/i.exec(
      source,
    );
  const type = match && imageType(match[1]);
  if (!match || !type) throw new Error('Invalid image data');
  let binary: string;
  if (match[2]) {
    if (!/^[a-z\d+/]*={0,2}$/i.test(match[3]))
      throw new Error('Invalid base64');
    binary = atob(match[3]);
  } else {
    if (/%(?![a-f\d]{2})/i.test(match[3]))
      throw new Error('Invalid image data');
    binary = match[3].replace(/%([a-f\d]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
  if (!binary.length || binary.length > maximumImageBytes)
    throw new Error('Invalid image size');
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { data, type };
}

function hasImageSignature(data: Uint8Array, type: ImageType): boolean {
  const startsWith = (bytes: number[]) =>
    bytes.every((byte, index) => data[index] === byte);
  switch (type) {
    case 'png':
      return startsWith([137, 80, 78, 71, 13, 10, 26, 10]);
    case 'jpg':
      return startsWith([255, 216, 255]);
    case 'gif':
      return (
        startsWith([71, 73, 70, 56]) &&
        (data[4] === 55 || data[4] === 57) &&
        data[5] === 97
      );
    case 'webp':
      return (
        startsWith([82, 73, 70, 70]) &&
        [87, 69, 66, 80].every((byte, index) => data[index + 8] === byte)
      );
    case 'svg':
      // Browser image decoding validates the XML; SVG stays in image context,
      // where scripts and external resources cannot execute or load.
      return data.byteLength > 0;
  }
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(
      () => finish(new Error('Image decode timed out')),
      15000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = '';
        reject(error);
      } else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Image decode failed'));
    image.src = dataUrl;
  });
}

async function prepareImage(
  data: Uint8Array,
  type: ImageType,
): Promise<OfficeImage> {
  if (
    !data.length ||
    data.length > maximumImageBytes ||
    !hasImageSignature(data, type)
  )
    throw new Error('Invalid image');
  const dataUrl = dataUrlFor(data, type);
  const image = await decodeImage(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > maximumImageDimension ||
    height > maximumImageDimension ||
    width * height > maximumImagePixels
  )
    throw new Error('Image dimensions exceed the export limit');
  if (type !== 'svg' && type !== 'webp')
    return { data, dataUrl, type, width, height };

  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
    const converted = readDataUrl(canvas.toDataURL('image/png'));
    if (converted.type !== 'png' || !hasImageSignature(converted.data, 'png'))
      throw new Error('Image conversion failed');
    return {
      data: converted.data,
      dataUrl: dataUrlFor(converted.data, 'png'),
      type: 'png',
      width,
      height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function imageError(source: string, locale: AppLocale, missing = false): Error {
  const label = /^data:/i.test(source)
    ? locale === 'ja'
      ? '埋め込み画像'
      : 'embedded image'
    : Array.from(source, (character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 ? ' ' : character;
      })
        .join('')
        .slice(0, 140);
  return new Error(
    locale === 'ja'
      ? missing
        ? `ファイル出力に必要な画像「${label}」が見つかりません。画像ファイルを読み込んでから再実行してください。`
        : `画像「${label}」をファイル出力用に変換できません。PNG、JPEGまたはGIF画像（最大20MB、各辺8192px・合計1677万画素以内）に置き換えて再実行してください。`
      : missing
        ? `The image "${label}" is missing. Import the image file before exporting the file.`
        : `Could not convert "${label}" for file export. Replace it with a PNG, JPEG or GIF image (up to 20 MB, 8192 pixels per side and 16.7 megapixels) and try again.`,
  );
}

/** Read only workspace-owned blobs and embedded data; never fetch remote images. */
export async function prepareOfficeImages(
  document: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ images: Map<string, OfficeImage> }> {
  const sources = new Map<string, string>();
  for (const node of walkDocumentTree(document.children)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    const original = node.attrs.src;
    const source = safeResourceUrl(original, 'image');
    if (/^(?:https?:|\/\/)/i.test(original.trim()))
      throw new Error(
        locale === 'ja'
          ? 'ファイル出力では外部URLの画像を使用できません。画像をローカルファイルとして読み込み、URLの画像と置き換えてから再実行してください。'
          : 'File export cannot use external image URLs. Import the image as a local file and replace the URL image before exporting.',
      );
    if (!source) throw imageError(original, locale);
    if (!/^data:/i.test(source) && !assets.get(source)?.startsWith('blob:'))
      throw imageError(source, locale, true);
    sources.set(original, source);
  }

  const images = new Map<string, OfficeImage>();
  const prepared = new Map<string, OfficeImage>();
  // Sequential decoding and conversion keep peak bitmap memory bounded.
  for (const [original, source] of sources) {
    const url = /^data:/i.test(source) ? source : assets.get(source)!;
    let image = prepared.get(url);
    if (!image) {
      try {
        if (/^data:/i.test(source)) {
          const inline = readDataUrl(source);
          image = await prepareImage(inline.data, inline.type);
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Unreadable attachment');
          const contentType = response.headers
            .get('content-type')
            ?.split(';', 1)[0]
            .trim();
          const extension = source
            .split(/[?#]/, 1)[0]
            .split('.')
            .at(-1)
            ?.toLowerCase();
          const type =
            contentType && contentType !== 'application/octet-stream'
              ? imageType(contentType)
              : imageType(
                  'image/' + (extension === 'svg' ? 'svg+xml' : extension),
                );
          if (!type) throw new Error('Unsupported image format');
          if (
            Number(response.headers.get('content-length')) > maximumImageBytes
          )
            throw new Error('Image is too large');
          image = await prepareImage(
            new Uint8Array(await response.arrayBuffer()),
            type,
          );
        }
        prepared.set(url, image);
      } catch {
        throw imageError(source, locale);
      }
    }
    images.set(original, image);
    images.set(source, image);
  }
  return { images };
}
