import { webcrypto } from 'node:crypto';
import { getSchema } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportReportHtml } from '@/src/export/report-html';
import { exportSlideHtml } from '@/src/export/slide-html';
import {
  editableHtmlId,
  editableHtmlPayload,
} from '@/src/export/editable-html';
import { bytesToBase64 } from '@/src/export/embedded-images';
import { walkDocumentTree } from '@/src/document/traversal';
import { toEditorDocument } from '@/src/document/model';
import { createEditorExtensions } from '@/src/editor/extensions';
import { importHtml } from './html-import';
import { readWorkspaceFiles, revokeAssetUrls } from './files';

const createUrl = vi.fn<(blob: Blob) => string>();
const revokeUrl = vi.fn();
beforeEach(() => {
  let sequence = 0;
  createUrl.mockReset().mockImplementation(() => 'blob:import-' + ++sequence);
  revokeUrl.mockReset();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const textNodes = (document: ReturnType<typeof importHtml>['document']) =>
  [...walkDocumentTree(document.children)]
    .filter((node) => node.type === 'text')
    .map((node) => node.text)
    .join(' ');
const template = (value: unknown) =>
  `<template id="${editableHtmlId}" data-encoding="base64">${bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))}</template>`;

function htmlFile(source: string, name = 'source.html') {
  const file = new File([source], name, { type: 'text/html' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(source) });
  return file;
}

describe('editable HTML round trip', () => {
  it.each(['report', 'slide'] as const)(
    'restores exact %s content, math, table spans, theme, notes and metadata',
    async (type) => {
      const source = parseMarkdown(
        `---\ntype: ${type}\ntitle: 日本語 </template><script>unsafe()</script>\ntheme: technical\n---\n\n# Title\n\n$x^2$ and **strong**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n::: notes\nRemember\n:::\n\n::: ${type === 'slide' ? 'slidebreak' : 'pagebreak'}\n:::\n\nEnd`,
      ).document;
      source.metadata.custom = { nested: ['日本語', 42] };
      const table = source.children.find((node) => node.type === 'table')!;
      table.content[0].content![0].attrs.colspan = 2;
      table.content[0].content!.splice(1, 1);
      const exported = await (
        type === 'slide' ? exportSlideHtml : exportReportHtml
      )(source, new Map(), 'ja');
      const result = importHtml(exported.html);
      expect(result.document).toEqual(source);
      expect(result.htmlImport).toMatchObject({
        kind: 'editable',
        pageCount: 2,
        warnings: [],
      });
      const parsed = new DOMParser().parseFromString(
        exported.html,
        'text/html',
      );
      expect(parsed.querySelectorAll('script')).toHaveLength(1);
      expect(parsed.querySelector('script')!.textContent).not.toContain(
        'unsafe()',
      );
    },
  );

  it('restores local SVG/raster attachments and keeps their original references', async () => {
    const source = parseMarkdown(
      '---\ntype: slide\n---\n\n![A](chart.svg)\n\n![Alias](same.svg)\n\n![Raster](picture.png)',
    ).document;
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(
          new Response(
            url === 'blob:svg'
              ? '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
              : new Uint8Array([1, 2, 3]),
            {
              headers: {
                'content-type':
                  url === 'blob:svg' ? 'image/svg+xml' : 'image/png',
              },
            },
          ),
        ),
      ),
    );
    const { html } = await exportSlideHtml(
      source,
      new Map([
        ['chart.svg', 'blob:svg'],
        ['same.svg', 'blob:svg'],
        ['picture.png', 'blob:png'],
      ]),
      'ja',
    );
    const result = await readWorkspaceFiles([htmlFile(html)]);
    expect(result.document).toEqual(source);
    expect(result.assets.size).toBe(3);
    expect(result.assets.get('chart.svg')).toBe(result.assets.get('same.svg'));
    expect(createUrl).toHaveBeenCalledTimes(2);
    expect(result.unresolved).toEqual([]);
    expect(result.assetBytes).toBeGreaterThan(3);
    revokeAssetUrls(result.assets);
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });

  it.each([
    { format: 'kumi-editable-html', version: 99, document: {}, assets: [] },
    { format: 'other', version: 1, document: {}, assets: [] },
    { format: 'kumi-editable-html', version: 1, document: {}, assets: [] },
  ])(
    'rejects invalid or unknown embedded data instead of falling back to visible HTML',
    (value) => {
      expect(() =>
        importHtml('<h1>Fallback must not import</h1>' + template(value)),
      ).toThrow();
      expect(createUrl).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed base64, duplicate markers, missing assets and deep metadata', () => {
    expect(() =>
      importHtml(
        `<template id="${editableHtmlId}" data-encoding="base64">invalid%</template><p>Visible</p>`,
      ),
    ).toThrow();
    const source = parseMarkdown('![Missing](missing.png)').document;
    const encoded = editableHtmlPayload(source, (value) => value);
    const marked = `<template id="${editableHtmlId}" data-encoding="base64">${encoded}</template>`;
    expect(() => importHtml(marked + marked)).toThrow(/重複/);
    expect(() => importHtml(marked)).toThrow(/不足/);
    let nested: unknown = 'deep';
    for (let count = 0; count < 70; count++) nested = [nested];
    expect(() =>
      importHtml(
        template({
          format: 'kumi-editable-html',
          version: 1,
          document: { ...source, metadata: { nested } },
          assets: [],
        }),
      ),
    ).toThrow(/深さ/);
  });

  it('releases already allocated assets if a later embedded asset fails', () => {
    const source = parseMarkdown('![A](a.png)\n\n![B](b.png)').document;
    expect(() =>
      importHtml(
        template({
          format: 'kumi-editable-html',
          version: 1,
          document: source,
          assets: [
            { source: 'a.png', data: 'data:image/png;base64,AQ==' },
            { source: 'b.png', data: 'data:text/html;base64,AQ==' },
          ],
        }),
      ),
    ).toThrow();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:import-1');
  });
});

describe('external HTML conversion', () => {
  it('preserves unusual list contents and empty code blocks in a valid editor tree', () => {
    const result = importHtml(
      '<ul><li><h2>Heading in list</h2><p>Text</p></li><li><ul><li>Nested item</li></ul></li><li><img src="image.png"></li><li></li></ul><pre></pre>',
    );
    const schema = getSchema(
      createEditorExtensions({ onMathSelect: () => undefined }),
    );
    expect(() =>
      schema.nodeFromJSON(toEditorDocument(result.document)).check(),
    ).not.toThrow();
    expect(textNodes(result.document)).toContain('Heading in list');
    expect(textNodes(result.document)).toContain('Nested item');
    const items = [...walkDocumentTree(result.document.children)].filter(
      (node) => node.type === 'listItem',
    );
    expect(items.every((item) => item.content[0]?.type === 'paragraph')).toBe(
      true,
    );
  });
  it('converts headings, spans, marks, lists, merged tables, source math and slide boundaries', () => {
    const result = importHtml(
      `<title>Imported deck</title><div class="reveal"><div class="slides"><section><h1>One</h1><p><span>Hello</span> <b>world</b><br>line <a href="https://example.com">link</a></p><ol start="3"><li>First<ul><li>Nested</li></ul></li></ol><table><tr><th colspan="2">Wide</th></tr><tr><td>A</td><td>B</td></tr></table><span class="katex"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math><span>duplicate visual</span></span></section><section><h2>Two</h2><script type="math/tex">a+b</script></section></div></div>`,
    );
    expect(result.document.metadata.title).toBe('Imported deck');
    expect(result.htmlImport).toMatchObject({
      kind: 'converted',
      pageCount: 2,
    });
    const nodes = [...walkDocumentTree(result.document.children)];
    expect(nodes.find((node) => node.type === 'orderedList')?.attrs.start).toBe(
      3,
    );
    expect(
      nodes.find((node) => node.type === 'tableHeader')?.attrs.colspan,
    ).toBe(2);
    expect(
      nodes
        .filter((node) => node.type === 'inlineMath')
        .map((node) => node.attrs.latex),
    ).toEqual(['x^2', 'a+b']);
    expect(textNodes(result.document)).not.toContain('duplicate visual');
    expect(result.document.metadata.html_import).toMatchObject({
      kind: 'converted',
      page_count: 2,
      warnings: result.htmlImport.warnings,
    });
  });

  it('never executes scripts or carries executable attributes and preserves unsupported fallbacks with warnings', () => {
    const result = importHtml(
      '<h1 onclick="alert(1)">Safe</h1><script>globalThis.importAttack = true</script><p><a href="javascript:alert(1)">kept link text</a><img src="javascript:alert(1)" alt="Kept alt"></p><iframe src="https://example.com">Frame fallback</iframe><canvas>Chart fallback</canvas><video></video>',
    );
    expect(
      (globalThis as Record<string, unknown>).importAttack,
    ).toBeUndefined();
    expect(JSON.stringify(result.document)).not.toContain('javascript:');
    expect(textNodes(result.document)).toContain('kept link text');
    expect(textNodes(result.document)).toContain('Kept alt');
    expect(textNodes(result.document)).toContain('Chart fallback');
    expect(textNodes(result.document)).toContain('未対応の video');
    expect(result.htmlImport.warnings.join(' ')).toMatch(
      /script.*iframe.*canvas.*video/,
    );
    expect(result.htmlImport.warnings.join(' ')).toContain('リンク先');
  });

  it('sanitizes SVG into a local image, removing script, foreignObject, external href and CSS', async () => {
    const result = importHtml(
      '<h1>Drawing</h1><svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>evil()</script><foreignObject><p>HTML</p></foreignObject><rect width="10" height="10" style="fill:url(https://example.com)"/><use href="https://example.com/a.svg#x"/></svg>',
    );
    expect(result.assets.size).toBe(1);
    const blob = createUrl.mock.calls[0][0];
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(blob);
    });
    expect(content).toContain('<rect');
    expect(content).not.toMatch(/script|foreignObject|onload|https:|style=/);
    expect(result.htmlImport.warnings.join(' ')).toContain('除去');
    expect(result.htmlImport.warnings.join(' ')).toContain('個別編集');
  });

  it('keeps safe SVG paint and text styles while stripping unsafe declarations', async () => {
    importHtml(
      '<svg xmlns="http://www.w3.org/2000/svg"><text style="fill:#2563eb;font-size:14px;font-family:Arial;stroke:url(https://example.com/a.svg#x)">Text</text></svg>',
    );
    const blob = createUrl.mock.calls[0][0];
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.readAsText(blob);
    });
    expect(content).toContain('fill:#2563eb');
    expect(content).toContain('font-size:14px');
    expect(content).not.toContain('https:');
  });

  it('shows the stored conversion report again after an editable HTML round trip', async () => {
    const imported = importHtml(
      '<h1>Converted</h1><canvas>Fallback chart</canvas>',
    );
    const exported = await exportReportHtml(
      imported.document,
      imported.assets,
      'ja',
    );
    const reopened = importHtml(exported.html);
    expect(reopened.htmlImport.kind).toBe('editable');
    expect(reopened.htmlImport.warnings).toEqual(imported.htmlImport.warnings);
    expect(reopened.document.metadata.html_import).toEqual(
      imported.document.metadata.html_import,
    );
  });

  it('keeps outside-slide text and reports malformed tables without losing cell text', () => {
    const result = importHtml(
      '<p>Before</p><div class="slide"><h1>Inside</h1><table><tr><td rowspan="5">A</td><td>B</td></tr></table></div><p>After</p>',
    );
    expect(textNodes(result.document)).toContain('Before');
    expect(textNodes(result.document)).toContain('After');
    expect(textNodes(result.document)).toContain('A');
    expect(textNodes(result.document)).toContain('B');
    expect(result.htmlImport.warnings.join(' ')).toContain('結合セル');
  });

  it('resolves supplied image attachments, warns about unresolved and external images, and retains conversion metadata', async () => {
    const result = await readWorkspaceFiles([
      htmlFile(
        '<h1>Images</h1><img src="local.png"><img src="missing.png"><img src="https://example.com/a.png">',
      ),
      new File(['pixels'], 'local.png', { type: 'image/png' }),
    ]);
    expect(result.assets.has('local.png')).toBe(true);
    expect(result.unresolved).toEqual(['missing.png']);
    expect(result.htmlImport?.warnings.join(' ')).toContain('未検証');
    expect(result.htmlImport?.warnings.join(' ')).toContain('解決できません');
  });

  it('rejects external trees beyond the supported nesting budget', () => {
    expect(() =>
      importHtml('<div>'.repeat(66) + 'text' + '</div>'.repeat(66)),
    ).toThrow(/深さ/);
  });
});
