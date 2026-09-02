import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { PreviewSurface } from './preview-surface';

describe('semantic preview', () => {
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
