import { z } from 'zod';

/** PDF originals are workspace attachments, never URLs fetched from a document. */
export function isLocalPdfAsset(value: string): boolean {
  if (!value || value.length > 240 || value !== value.trim()) return false;
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return false;
  }
  return (
    /\.pdf$/i.test(path) &&
    !/^[a-z][a-z\d+.-]*:/i.test(path) &&
    !/[\\:*?"<>|#]/.test(path) &&
    !Array.from(path).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    path
      .split('/')
      .every(
        (part) =>
          Boolean(part) &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(?:__proto__|constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
            part,
          ),
      )
  );
}

export const pdfSourceSchema = z
  .strictObject({
    asset: z
      .string()
      .refine(isLocalPdfAsset, 'PDF原本には安全なローカル素材パスが必要です'),
    fileName: z.string().min(1).max(255),
    page: z.number().int().min(1).max(100000),
    pageCount: z.number().int().min(1).max(100000),
    dpi: z.number().positive().max(600),
  })
  .refine(
    (value) => value.page <= value.pageCount,
    'PDFページ番号が範囲外です',
  );
export type PdfSource = z.infer<typeof pdfSourceSchema>;

export const maximumPdfBytes = 20 * 1024 * 1024;
export function validatePdfBytes(
  bytes: Uint8Array,
  mime = 'application/pdf',
): void {
  if (mime.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf')
    throw new Error('PDF原本のMIME形式が不正です。');
  if (bytes.byteLength > maximumPdfBytes)
    throw new Error('PDF原本が20 MiBを超えています。');
  if (
    bytes.length < 8 ||
    String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-'
  )
    throw new Error('PDF原本の識別情報が不正です。');
}
