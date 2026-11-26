import { renderToStaticMarkup } from 'react-dom/server.browser';
import { describe, expect, it } from 'vitest';
import { splitRenderedPages } from '@/src/document/report-pages';
import { analyzeDocument } from '@/src/document/semantics';
import { parseMarkdown } from '@/src/markdown/parser';
import { DocumentPage } from './document-page';

function render(frontMatter: string, body: string, locale: 'ja' | 'en' = 'ja') {
  const document = parseMarkdown(
    `---\ntype: report\n${frontMatter}\n---\n\n${body}`,
  ).document;
  const pages = splitRenderedPages(document);
  const analysis = analyzeDocument(document);
  const container = globalThis.document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <>
      {pages.map((nodes, index) => (
        <DocumentPage
          key={index}
          document={document}
          nodes={nodes}
          analysis={analysis}
          locale={locale}
          index={index}
          count={pages.length}
        />
      ))}
    </>,
  );
  return container;
}

const body =
  '# Intro\n\n## Scope\n\n![Alt](a.png)\n{#fig:a caption="Frame"}\n\n| A |\n| - |\n| 1 |\n{#tab:a caption="Loads"}\n\n> [!NOTE]\n> Remember';

describe('stable formatting hooks in the report DOM', () => {
  it('separates numbers, separators and text without changing the visible text', () => {
    const page = render('number_sections: true\ntoc: true', body);
    const heading = page.querySelector('h1[id]')!;
    expect(heading.textContent).toBe('1 Intro');
    expect(heading.querySelector('.section-number')!.textContent).toBe('1');
    expect(heading.querySelector('.section-separator')!.textContent).toBe(' ');
    const caption = page.querySelector('figcaption')!;
    expect(caption.querySelector('.caption-label')!.textContent).toBe('図 1');
    expect(caption.querySelector('.caption-separator')!.textContent).toBe(
      ' — ',
    );
    expect(caption.querySelector('.caption-text')!.textContent).toBe('Frame');
    expect(page.querySelector('table caption')!.textContent).toBe(
      '表 1 — Loads',
    );
    const entries = [...page.querySelectorAll('.document-toc li')];
    expect(
      entries.map((entry) => entry.getAttribute('data-toc-level')),
    ).toEqual(['1', '2']);
    // Earlier style sheets select the level through this inline style.
    expect(entries[0].getAttribute('style')).toContain('padding-left:0px');
    expect(entries[1].textContent).toBe('1.1 Scope');
    expect(page.querySelector('.callout-title')!.textContent).toBe('注記');
    expect(page.querySelector('[data-report-page-kind="body"]')).not.toBeNull();
  });

  it('applies the caption separator, callout titles, contents title and page number format', () => {
    const page = render(
      [
        'toc: true',
        'report_settings:',
        '  cover: true',
        '  cover_layout: centered',
        '  toc_page: true',
        '  toc_title: 目 次',
        '  list_figures: true',
        '  caption_separator: ": "',
        '  page_number_format: "- {n} / {total} -"',
        '  page_number_position: bottom-right',
        '  callout_labels:',
        '    note: （注）',
      ].join('\n'),
      body,
    );
    expect(page.querySelector('figcaption')!.textContent).toBe('図 1: Frame');
    expect(page.querySelector('.callout-title')!.textContent).toBe('（注）');
    expect(page.querySelector('.document-toc h2')!.textContent).toBe('目 次');
    expect(page.querySelector('.document-caption-list li')!.textContent).toBe(
      '図 1: Frame',
    );
    expect(
      page.querySelector('.report-cover')!.getAttribute('data-cover-layout'),
    ).toBe('centered');
    const bodyPage = page.querySelector('[data-report-page-kind="body"]')!;
    expect(bodyPage.querySelector('footer')!.textContent).toBe('- 1 / 1 -');
    expect(bodyPage.getAttribute('data-page-number-position')).toBe(
      'bottom-right',
    );
  });

  it('omits an empty callout title and uses theme wording only where it was written for the locale', () => {
    const hidden = render(
      'report_settings:\n  callout_labels:\n    note: ""',
      body,
    );
    expect(hidden.querySelector('.callout-title')).toBeNull();
    expect(hidden.querySelector('blockquote')!.textContent).toBe('Remember');
    const themed = render('theme: report-jp\ntoc: true', body);
    expect(themed.querySelector('.callout-title')!.textContent).toBe('（注）');
    expect(themed.querySelector('.document-toc h2')!.textContent).toBe('目 次');
    expect(themed.querySelector('footer')!.textContent).toBe('- 1 -');
    expect(
      themed
        .querySelector('[data-report-page-kind="body"]')!
        .hasAttribute('data-page-number-position'),
    ).toBe(false);
    const english = render('theme: report-jp\ntoc: true', body, 'en');
    expect(english.querySelector('.callout-title')!.textContent).toBe('Note');
  });
});
