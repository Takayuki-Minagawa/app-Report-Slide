import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { parseMarkdown } from '@/src/markdown/parser';
import { slideNavigationPages } from '@/src/document/slide-navigation';
import { SlideNavigation } from './slide-navigation';

describe('slide navigation', () => {
  beforeEach(() => window.localStorage.clear());

  it('finds pages by number/title and focuses body elements by accessible name', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# Intro\n\nFirst body\n\n::: slidebreak\n:::\n\n# Results\n\nValue 29 kg',
    ).document;
    const onFocus = vi.fn();
    const onPageSelect = vi.fn();
    render(
      <AppPreferencesProvider>
        <SlideNavigation
          document={document}
          onFocus={onFocus}
          onPageSelect={onPageSelect}
        />
      </AppPreferencesProvider>,
    );
    const search = screen.getByRole('searchbox', {
      name: 'ページ番号・タイトルで検索',
    });
    fireEvent.change(search, { target: { value: 'Results' } });
    expect(
      screen.queryByRole('button', { name: '1 Intro' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 Results' }));
    expect(onPageSelect).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: '本文 1 Value 29 kg' }));
    expect(onFocus).toHaveBeenLastCalledWith(
      document.children.at(-1)!.attrs.nodeId,
    );
    fireEvent.change(search, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: '1 Intro' })).toBeInTheDocument();
  });

  it('keeps empty pages and nested editable targets addressable', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n::: slidebreak\n:::\n\n# A\n\n- nested value\n\n::: slidebreak\n:::',
    ).document;
    const pages = slideNavigationPages(document, 'ja');
    expect(pages).toHaveLength(3);
    expect(pages[0].anchorNodeId).toBe(document.children[0].attrs.nodeId);
    expect(
      pages[1].elements.some((element) => element.text === 'nested value'),
    ).toBe(true);
    expect(pages[2].elements).toHaveLength(0);
  });
});
