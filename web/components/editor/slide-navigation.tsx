'use client';

import { useMemo, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData } from '@/src/document/model';
import { slideNavigationPages } from '@/src/document/slide-navigation';

export interface SlideNavigationProps {
  document: DocumentData;
  selectedNodeId?: string;
  currentPageIndex?: number;
  onFocus: (nodeId: string) => void;
  onPageSelect?: (index: number) => void;
}

export function SlideNavigation({
  document,
  selectedNodeId,
  currentPageIndex,
  onFocus,
  onPageSelect,
}: SlideNavigationProps) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [query, setQuery] = useState('');
  const [requestedPage, setRequestedPage] = useState(0);
  const pages = useMemo(
    () => slideNavigationPages(document, locale),
    [document, locale],
  );
  const selectedPage =
    currentPageIndex ??
    pages.find((page) =>
      page.elements.some((element) => element.nodeId === selectedNodeId),
    )?.index ??
    requestedPage;
  const activePage =
    pages[Math.max(0, Math.min(selectedPage, pages.length - 1))];
  const filtered = pages.filter(
    (page) =>
      !query.trim() ||
      String(page.index + 1) === query.trim() ||
      page.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  if (document.type !== 'slide') return null;

  return (
    <section
      className="space-y-3 border-b p-3"
      aria-label={ja ? 'スライドと編集対象' : 'Slides and editing targets'}
    >
      <label className="grid gap-1 text-xs">
        {ja ? 'ページ番号・タイトルで検索' : 'Find page by number or title'}
        <input
          type="search"
          className="h-8 w-full rounded-md border bg-background px-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <nav
        className="max-h-48 space-y-1 overflow-y-auto"
        aria-label={ja ? 'スライド一覧' : 'Slide list'}
      >
        {filtered.map((page) => (
          <button
            key={page.index}
            type="button"
            className={`navigator-item w-full ${page.index === activePage.index ? 'navigator-item-active' : ''}`}
            aria-current={page.index === activePage.index ? 'page' : undefined}
            onClick={() => {
              setRequestedPage(page.index);
              onPageSelect?.(page.index);
              if (page.anchorNodeId) onFocus(page.anchorNodeId);
            }}
          >
            <span className="font-mono">{page.index + 1}</span>
            <span className="truncate">{page.title}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {ja ? '該当するページはありません。' : 'No matching pages.'}
          </p>
        )}
      </nav>
      <p className="text-xs font-medium">
        {ja
          ? `${activePage.index + 1}ページの編集対象`
          : `Elements on page ${activePage.index + 1}`}
      </p>
      <fieldset
        className="max-h-52 space-y-1 overflow-y-auto"
        aria-label={ja ? '編集対象一覧' : 'Editing targets'}
      >
        {activePage.elements.map((element) => (
          <button
            key={element.nodeId}
            type="button"
            className={`navigator-item w-full ${selectedNodeId === element.nodeId ? 'navigator-item-active' : ''}`}
            aria-pressed={selectedNodeId === element.nodeId}
            onClick={() => onFocus(element.nodeId)}
          >
            <span className="shrink-0">{element.name}</span>
            <span className="truncate text-muted-foreground">
              {element.text}
            </span>
          </button>
        ))}
        {activePage.elements.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {ja ? '空のページです。' : 'This page is empty.'}
          </p>
        )}
      </fieldset>
    </section>
  );
}
