import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { PreviewSurface } from './preview-surface';

describe('semantic preview', () => {
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
});
