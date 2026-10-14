import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { exportReportHtml } from '@/src/export/report-html';
import { preservedContent } from '@/src/document/preserved-content';
import { validateDocumentData } from '@/src/document/validation';
import { importDocumentData } from './import-document';
import { importHtml } from './html-import';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));

describe('import-only preservation', () => {
  it('retains unknown blocks and nested marks through JSON, Markdown and editable HTML', async () => {
    const unknown = {
      type: 'futureDiagram',
      attrs: { nodeId: 'future', code: '<script>bad()</script>' },
      content: [],
    };
    const source = parseMarkdown('# Heading\n\nEditable').document;
    const value = {
      ...source,
      children: [
        ...source.children,
        unknown,
        {
          type: 'paragraph',
          attrs: { nodeId: 'marked' },
          content: [
            { type: 'text', text: 'special', marks: [{ type: 'futureMark' }] },
          ],
        },
      ],
    };
    const converted = importDocumentData(value);
    expect(value.children[2]).toEqual(unknown);
    expect(converted.children.slice(0, 2)).toEqual(source.children);
    const entries = preservedContent(converted.metadata);
    expect(entries).toHaveLength(2);
    expect(JSON.parse(entries[0].source)).toEqual(unknown);
    expect(entries[1].name).toContain('futureMark');
    expect(() => validateDocumentData(value)).toThrow();
    expect(importDocumentData(JSON.parse(JSON.stringify(converted)))).toEqual(
      converted,
    );
    expect(
      preservedContent(
        parseMarkdown(serializeDocument(converted)).document.metadata,
      ),
    ).toEqual(entries);
    const html = await exportReportHtml(converted, new Map(), 'ja');
    expect(preservedContent(importHtml(html.html).document.metadata)).toEqual(
      entries,
    );
    expect(
      new DOMParser()
        .parseFromString(html.html, 'text/html')
        .querySelector('script')!.textContent,
    ).not.toContain('bad()');
  });

  it('keeps unsupported image/PDF references available for archive persistence', () => {
    const result = importDocumentData({
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'futureImage',
          attrs: {
            src: 'assets/chart.png',
            figureEdit: { pdfSource: { asset: 'assets/original.pdf' } },
          },
        },
      ],
    });
    expect(preservedContent(result.metadata)[0].assets).toEqual([
      { source: 'assets/chart.png', kind: 'image' },
      { source: 'assets/original.pdf', kind: 'pdf' },
    ]);
  });

  it('still rejects unknown envelope versions, malformed known blocks and malicious keys', () => {
    const source = parseMarkdown('Safe').document;
    expect(() =>
      importDocumentData({ ...source, schemaVersion: 99 }),
    ).toThrow();
    expect(() =>
      importDocumentData({
        ...source,
        children: [{ type: 'heading', attrs: { nodeId: 'bad', level: 8 } }],
      }),
    ).toThrow();
    expect(() =>
      importDocumentData(
        JSON.parse(
          '{"schemaVersion":2,"type":"report","metadata":{},"children":[{"type":"future","__proto__":{}}]}',
        ),
      ),
    ).toThrow();
  });

  it('preserves external HTML as inert text and survives its next editable export', async () => {
    const source =
      '<style>.special{color:red}</style><h1>原資料</h1><canvas>chart</canvas><script>bad()</script>';
    const converted = importHtml(source, 'legacy.html');
    expect(preservedContent(converted.document.metadata)[0].source).toBe(
      source,
    );
    const exported = await exportReportHtml(
      converted.document,
      new Map(),
      'ja',
    );
    expect(
      preservedContent(importHtml(exported.html).document.metadata)[0].source,
    ).toBe(source);
    expect(
      new DOMParser()
        .parseFromString(exported.html, 'text/html')
        .querySelector('canvas'),
    ).toBeNull();
  });
});
