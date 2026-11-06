import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentPage } from '@/components/preview/document-page';
import { defaultPageSettings } from '@/src/document/page-settings';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportReportHtml } from './report-html';
import { exportPrintHtml } from './print-html';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

function sample() {
  const document = parseMarkdown(
    '# Heading\n\n::: pagebreak\n:::\n\nFirst\n\nNormal\n\nException\n{first_line_indent=0}\n\nExplicit\n{first_line_indent=1 text_ruler=10,5,20}\n\n> Quote\n\n- List\n\n| Value |\n| --- |\n| Cell |',
  ).document;
  document.metadata.page_settings = {
    ...defaultPageSettings,
    first_line_indent: 1,
    after_heading_indent: 'none',
  };
  return document;
}

function checkOutput(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs = [
    ...parsed.querySelectorAll<HTMLElement>('.document-renderer > p'),
  ];
  expect(paragraphs.map((p) => p.style.textIndent)).toEqual([
    '0em',
    '1em',
    '0em',
    '1em',
  ]);
  expect(paragraphs[3].style.marginLeft).toBe('10%');
  expect(paragraphs[3].style.marginRight).toBe('5%');
  for (const nested of parsed.querySelectorAll<HTMLElement>(
    'blockquote p, li p, td p, th p',
  )) {
    expect(nested.style.textIndent).toBe('0em');
  }
}

describe('report paragraph format across rendering paths', () => {
  it('uses whole-document context in a single-page preview', () => {
    const document = sample();
    checkOutput(
      renderToStaticMarkup(
        <DocumentPage
          document={document}
          nodes={splitDocumentPages(document)[1]}
          analysis={analyzeDocument(document)}
          locale="ja"
          index={1}
          count={2}
        />,
      ),
    );
  });
  it('preserves the same paragraph rules in standalone and printable HTML', async () => {
    const document = sample();
    checkOutput((await exportReportHtml(document, new Map(), 'ja')).html);
    checkOutput((await exportPrintHtml(document, new Map(), 'ja')).html);
  });
  it('does not apply report paragraph attributes to slides', async () => {
    const document = sample();
    document.type = 'slide';
    const parsed = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <DocumentPage
          document={document}
          nodes={splitDocumentPages(document)[1]}
          analysis={analyzeDocument(document)}
          locale="ja"
          index={1}
          count={2}
        />,
      ),
      'text/html',
    );
    expect(
      parsed.querySelector<HTMLElement>('.document-renderer > p')?.style
        .textIndent,
    ).toBe('');
  });
});
