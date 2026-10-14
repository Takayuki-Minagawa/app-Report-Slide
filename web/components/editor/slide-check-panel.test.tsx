import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { parseMarkdown } from '@/src/markdown/parser';
import { SlideCheckPanel } from './slide-check-panel';

function bounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

function ordinaryBounds(this: HTMLElement): DOMRect {
  if (this.tagName === 'ARTICLE') return bounds(0, 0, 920, 517.5);
  if (this.tagName === 'FOOTER') return bounds(66, 485, 854, 500);
  if (this.tagName === 'H1') return bounds(66, 30, 800, 65);
  if (this.dataset.nodeId)
    return bounds(
      66,
      90,
      this.textContent?.includes('Overflow') ? 1100 : 800,
      125,
    );
  return bounds(0, 0, 0, 0);
}

describe('on-demand slide checks', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      display: 'block',
      visibility: 'visible',
      fontSize: '16px',
      overflow: 'visible',
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      ordinaryBounds,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('mounts no check canvases at startup, checks all pages, and opens an issue target', async () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# A\n\nNormal\n\n::: slidebreak\n:::\n\n# B\n\nOverflow',
    ).document;
    const onFocus = vi.fn();
    const onPageSelect = vi.fn();
    render(
      <AppPreferencesProvider>
        <SlideCheckPanel
          document={document}
          onFocus={onFocus}
          onPageSelect={onPageSelect}
        />
      </AppPreferencesProvider>,
    );
    expect(
      window.document.querySelector('[data-slide-check-stage]'),
    ).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全ページをチェック' }));
    expect(
      window.document.querySelector('[data-slide-check-stage]'),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('2ページの検査完了'),
    );
    expect(
      window.document.querySelector('[data-slide-check-stage]'),
    ).toBeNull();
    const results = screen.getByRole('list', { name: '検査結果' });
    expect(results).toHaveTextContent('2. B — 本文 1');
    fireEvent.click(
      within(results).getByRole('button', { name: '対象を開く' }),
    );
    expect(onPageSelect).toHaveBeenCalledWith(1);
    expect(onFocus).toHaveBeenCalledWith(
      document.children.at(-1)!.attrs.nodeId,
    );
  });

  it('invalidates old results after an edit instead of reporting them as current', async () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# A\n\nOverflow',
    ).document;
    const view = (source: typeof document) => (
      <AppPreferencesProvider>
        <SlideCheckPanel document={source} onFocus={() => {}} />
      </AppPreferencesProvider>
    );
    const { rerender } = render(view(document));
    fireEvent.click(screen.getByRole('button', { name: '全ページをチェック' }));
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1ページの検査完了'),
    );
    rerender(
      view({
        ...document,
        metadata: { ...document.metadata, title: 'Edited' },
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '文書が変更されました',
    );
    expect(
      screen.queryByRole('list', { name: '検査結果' }),
    ).not.toBeInTheDocument();
  });

  it('invalidates completed results when the minimum font-size threshold changes', async () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# A\n\nNormal',
    ).document;
    render(
      <AppPreferencesProvider>
        <SlideCheckPanel document={document} onFocus={() => {}} />
      </AppPreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '全ページをチェック' }));
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '1ページの検査完了：0件',
      ),
    );
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: '最小文字サイズ（幅920 px換算）',
      }),
      { target: { value: '20' } },
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '検査条件が変更されました',
    );
    expect(
      screen.queryByRole('list', { name: '検査結果' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1ページの検査完了'),
    );
    expect(screen.getByRole('list', { name: '検査結果' })).toHaveTextContent(
      '小さい文字',
    );
  });

  it('checks generated footnotes against the footer and focuses their source paragraph', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.parentElement?.classList.contains('document-footnotes'))
          return bounds(66, 490, 854, 510);
        return ordinaryBounds.call(this);
      },
    );
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          display: 'block',
          visibility: 'visible',
          fontSize: element.closest('.document-footnotes') ? '10px' : '16px',
          overflow: 'visible',
          getPropertyValue: () => '',
        }) as unknown as CSSStyleDeclaration,
    );
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# A\n\nNormal ^[重要な適用条件 29 kg]',
    ).document;
    const onFocus = vi.fn();
    render(
      <AppPreferencesProvider>
        <SlideCheckPanel document={document} onFocus={onFocus} />
      </AppPreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '全ページをチェック' }));
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1ページの検査完了'),
    );
    const items = within(
      screen.getByRole('list', { name: '検査結果' }),
    ).getAllByRole('listitem');
    const footerIssue = items.find(
      (item) =>
        item.textContent?.includes('脚注 1') &&
        item.textContent?.includes('フッター'),
    )!;
    expect(footerIssue).toBeInTheDocument();
    expect(
      items.some(
        (item) =>
          item.textContent?.includes('脚注 1') &&
          item.textContent?.includes('小さい文字'),
      ),
    ).toBe(true);
    fireEvent.click(
      within(footerIssue).getByRole('button', { name: '対象を開く' }),
    );
    expect(onFocus).toHaveBeenCalledWith(document.children[1].attrs.nodeId);
  });

  it('uses the retained original dimensions and crop area for raster resolution hints', async () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(
      bounds(100, 100, 500, 300),
    );
    const document = parseMarkdown(
      '---\ntype: slide\n---\n# Cropped original\n\n![Original](original.png)',
    ).document;
    const figure = document.children[1];
    if (figure.type !== 'figure') throw new Error('Expected figure');
    figure.attrs.figureEdit = {
      version: 1,
      imageSize: { width: 400, height: 200 },
      crop: { x: 0, y: 0, width: 50, height: 50 },
    };
    render(
      <AppPreferencesProvider>
        <SlideCheckPanel document={document} onFocus={() => {}} />
      </AppPreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '全ページをチェック' }));
    fireEvent.click(screen.getByRole('button', { name: '検査を実行' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('1ページの検査完了'),
    );
    expect(screen.getByRole('list', { name: '検査結果' })).toHaveTextContent(
      '約0.50倍',
    );
    expect(screen.getByRole('list', { name: '検査結果' })).toHaveTextContent(
      '軸と凡例',
    );
  });
});
