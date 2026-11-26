// Bundled for the browser: Word export decodes and rasterizes images with
// canvas, exactly as the editor does, so the CLI runs it inside Chromium.
import { exportReportDocx } from '../web/src/export/report-docx';

declare global {
  // oxlint-disable-next-line no-var -- A page global is the bridge to Playwright.
  var kumiExportDocx: (
    document: unknown,
    assets: Array<[string, string, string]>,
    locale: 'ja' | 'en',
  ) => Promise<{ base64: string; warnings: string[] }>;
}

globalThis.kumiExportDocx = async (document, assets, locale) => {
  const urls = new Map<string, string>();
  try {
    for (const [source, type, base64] of assets) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      urls.set(source, URL.createObjectURL(new Blob([bytes], { type })));
    }
    const { blob, warnings } = await exportReportDocx(
      document as Parameters<typeof exportReportDocx>[0],
      urls,
      locale,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { base64: btoa(binary), warnings };
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
};
