import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { PreviewSurface } from './preview-surface';

describe('semantic preview', () => {
  it('renders only one project page and follows cross-page references with keyboard focus', async () => {
    const document = parseMarkdown(
      '---\ntype: report\ntoc: true\nnumber_sections: true\n---\n\n# Intro\n{#sec:intro}\n\n[@fig:result]\n\n::: pagebreak\n:::\n\n# Results\n{#sec:results}\n\n![Result](result.svg)\n{#fig:result caption="Outcome"}',
    ).document;
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} paginated />
      </AppPreferencesProvider>,
    );
    expect(container.querySelectorAll('.report-preview')).toHaveLength(1);
    expect(screen.getByLabelText('A4レポートプレビュー')).toHaveAttribute(
      'data-page',
      '1',
    );
    fireEvent.click(screen.getByRole('link', { name: '図 1' }));
    expect(screen.getByLabelText('A4レポートプレビュー')).toHaveAttribute(
      'data-page',
      '2',
    );
    expect(container.querySelectorAll('.report-preview')).toHaveLength(1);
    await waitFor(() =>
      expect(window.document.activeElement).toHaveTextContent('Outcome'),
    );
    fireEvent.click(screen.getByRole('button', { name: '前のページ' }));
    fireEvent.click(screen.getByRole('link', { name: '2 Results' }));
    expect(screen.getByLabelText('A4レポートプレビュー')).toHaveAttribute(
      'data-page',
      '2',
    );
    expect(screen.getByRole('heading', { name: '2 Results' })).toHaveFocus();
  });

  it('keeps a large project preview bounded and clamps the selected page after exclusion', () => {
    const document = parseMarkdown(
      Array.from(
        { length: 40 },
        (_, index) => `# Page ${index + 1}\n\nBody ${index + 1}`,
      ).join('\n\n::: pagebreak\n:::\n\n'),
    ).document;
    const { container, rerender } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} paginated />
      </AppPreferencesProvider>,
    );
    fireEvent.change(screen.getByRole('combobox', { name: '表示ページ' }), {
      target: { value: '39' },
    });
    expect(container.querySelectorAll('.report-preview')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'Page 40' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Page 1' }),
    ).not.toBeInTheDocument();
    const smaller = parseMarkdown('# Only page').document;
    rerender(
      <AppPreferencesProvider>
        <PreviewSurface document={smaller} paginated />
      </AppPreferencesProvider>,
    );
    expect(
      screen.getByRole('heading', { name: 'Only page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前のページ' })).toBeDisabled();
  });
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.lang = 'ja';
  });

  it('renders TOC, numbered headings/captions and linked references across pages', () => {
    const document = parseMarkdown(
      '---\ntype: report\ntoc: true\nnumber_sections: true\n---\n\n# Intro\n{#sec:intro}\n\n[@fig:a]\n\n::: pagebreak\n:::\n\n![a](a.svg)\n{#fig:a caption="結果"}',
    ).document;
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} />
      </AppPreferencesProvider>,
    );
    expect(screen.getAllByLabelText('A4レポートプレビュー')).toHaveLength(2);
    expect(screen.getByRole('navigation', { name: '目次' })).toHaveTextContent(
      '1 Intro',
    );
    const link = screen.getByRole('link', { name: '図 1' });
    expect(
      container.querySelector(
        `[id="${decodeURIComponent(link.getAttribute('href')!.slice(1))}"]`,
      ),
    ).toHaveTextContent('図 1 — 結果');
  });

  it('renders all slides separately and honors slide_number:false', () => {
    const document = parseMarkdown(
      '---\ntype: slide\nslide_number: false\n---\n\n# A\n\n::: slidebreak\n:::\n\n# B\n\n::: slidebreak\n:::\n\n# C',
    ).document;
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} />
      </AppPreferencesProvider>,
    );
    const slides = screen.getAllByLabelText('スライドプレビュー');
    expect(slides).toHaveLength(3);
    expect(slides[0]).not.toHaveTextContent('B');
    expect(slides[1]).toHaveTextContent('B');
    expect(container.querySelector('footer')).not.toHaveTextContent('1');
  });

  it('localizes generated references and captions in English', async () => {
    window.localStorage.setItem('kumi.locale', 'en');
    const document = parseMarkdown(
      '---\ntype: report\n---\n\n[@fig:a]\n\n![a](a.svg)\n{#fig:a caption="Result"}',
    ).document;
    const { container } = render(
      <AppPreferencesProvider>
        <PreviewSurface document={document} />
      </AppPreferencesProvider>,
    );

    const link = await screen.findByRole('link', { name: 'Figure 1' });
    await waitFor(() => {
      expect(container).toHaveTextContent('Figure 1 — Result');
    });
    expect(link).toBeInTheDocument();
  });
});
