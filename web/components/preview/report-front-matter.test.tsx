import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { PreviewSurface } from './preview-surface';

beforeEach(() => window.localStorage.clear());
function report() {
  const document = parseMarkdown(
    '# Introduction\n\n## Detail\n\n### Deep detail\n\n::: pagebreak\n:::\n\n# Findings\n\n![Figure](https://example.com/figure.svg)\n{#fig:result caption="Response"}\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n{#table:result caption="Results"}',
  ).document;
  Object.assign(document.metadata, {
    title: 'Technical report',
    subtitle: 'Study results',
    author: 'Author Name',
    date: '2026-11-06',
    toc: true,
    number_sections: true,
    report_settings: {
      cover: true,
      toc_page: true,
      toc_depth: 2,
      heading_numbering: 'chapter',
      caption_numbering: 'chapter',
      list_figures: true,
      list_tables: true,
      affiliation: 'Research team',
      recipient: '',
      report_number: 'R-001',
    },
  });
  return document;
}

describe('Report front matter', () => {
  it('renders a cover without empty fields and starts body numbering at one', () => {
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={report()} />
      </AppPreferencesProvider>,
    );
    const pages = [...container.querySelectorAll('article.report-preview')];
    expect(pages).toHaveLength(4);
    const cover = within(pages[0] as HTMLElement);
    expect(
      cover.getByRole('heading', { name: 'Technical report' }),
    ).toBeInTheDocument();
    expect(cover.getByText('Research team')).toBeInTheDocument();
    expect(cover.queryByText('提出先')).not.toBeInTheDocument();
    expect(pages[0].querySelector('footer')).toBeNull();
    expect(pages[1].querySelector('footer')).toBeNull();
    expect(pages[2].querySelector('footer')?.textContent).toBe('1');
    expect(pages[3].querySelector('footer')?.textContent).toBe('2');
    const toc = screen.getByRole('navigation', { name: '目次' });
    expect(
      within(toc).getByRole('link', { name: '第1章 Introduction' }),
    ).toBeInTheDocument();
    expect(
      within(toc).queryByRole('link', { name: /Deep detail/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: '図目次' }),
    ).toHaveTextContent('図 2.1 — Response');
    expect(
      screen.getByRole('navigation', { name: '表目次' }),
    ).toHaveTextContent('表 2.1 — Results');
  });

  it('follows contents links to the shifted rendered page and focuses the destination', () => {
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={report()} paginated />
      </AppPreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));
    fireEvent.click(screen.getByRole('link', { name: '第2章 Findings' }));
    expect(
      screen.getByRole('heading', { name: '第2章 Findings' }),
    ).toHaveFocus();
    expect(container.querySelector('article')?.getAttribute('data-page')).toBe(
      '4',
    );
    expect(container.querySelector('article > footer')?.textContent).toBe('2');
  });

  it('shows an empty contents notice instead of an unexplained blank sheet', () => {
    const document = parseMarkdown('').document;
    document.metadata.toc = true;
    document.metadata.report_settings = { toc_page: true };
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} />
      </AppPreferencesProvider>,
    );
    expect(container.querySelectorAll('article.report-preview')).toHaveLength(
      1,
    );
    expect(screen.getByText(/掲載する項目がありません/)).toBeInTheDocument();
  });
});
