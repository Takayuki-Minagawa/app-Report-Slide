'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { walkDocumentTree } from '@/src/document/traversal';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { DocumentData } from '@/src/document/model';
import {
  analyzeDocument,
  splitDocumentPages,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import { DocumentPage } from './document-page';

export function PreviewSurface({
  document,
  resolveImageUrl,
  analysis: providedAnalysis,
  paginated = false,
}: {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
  analysis?: DocumentAnalysis;
  paginated?: boolean;
}) {
  const { copy, locale } = useAppPreferences();
  const slide = document.type === 'slide';
  const analysis = useMemo(
    () => providedAnalysis ?? analyzeDocument(document),
    [document, providedAnalysis],
  );
  const pages = useMemo(() => splitDocumentPages(document), [document]);
  const [pageIndex, setPageIndex] = useState(0);
  const [anchorRequest, setAnchorRequest] = useState<{ id: string } | null>(
    null,
  );
  const content = useRef<HTMLDivElement>(null);
  const activePage = Math.min(pageIndex, pages.length - 1);
  const anchorPages = useMemo(() => {
    const targets = new Map<string, number>();
    if (paginated)
      pages.forEach((nodes, index) => {
        for (const node of walkDocumentTree(nodes)) {
          if ('attrs' in node && 'nodeId' in node.attrs)
            targets.set(`kumi-${node.attrs.nodeId}`, index);
        }
      });
    return targets;
  }, [pages, paginated]);
  useEffect(() => {
    if (!anchorRequest || !content.current) return;
    const target = [
      ...content.current.querySelectorAll<HTMLElement>('[id]'),
    ].find((element) => element.id === anchorRequest.id);
    if (target) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'start' });
    }
  }, [activePage, anchorRequest]);
  const navigate = (page: number) => {
    setAnchorRequest(null);
    setPageIndex(page);
  };
  const followReference = (event: MouseEvent<HTMLDivElement>) => {
    if (
      !paginated ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest('a[href^="#"]')
        : null;
    const href = link?.getAttribute('href');
    if (!href) return;
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch {
      return;
    }
    const destination = anchorPages.get(id);
    if (destination === undefined) return;
    event.preventDefault();
    setPageIndex(destination);
    setAnchorRequest({ id });
  };

  return (
    <div className="preview-pages">
      <div className="preview-page-summary">
        {slide
          ? copy.preview.slides(pages.length)
          : copy.preview.pages(pages.length)}
      </div>
      {paginated && (
        <nav
          className="flex flex-wrap items-center justify-center gap-3 rounded-md border bg-card p-3"
          aria-label={copy.project.previewNavigation}
        >
          <Button
            variant="outline"
            size="sm"
            disabled={activePage === 0}
            onClick={() => navigate(activePage - 1)}
          >
            {copy.project.previousPage}
          </Button>
          <NativeSelect
            aria-label={copy.project.page}
            size="sm"
            value={activePage}
            onChange={(event) => navigate(Number(event.target.value))}
          >
            {pages.map((_, index) => (
              <NativeSelectOption key={index} value={index}>
                {copy.project.pagePosition(index + 1, pages.length)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            disabled={activePage === pages.length - 1}
            onClick={() => navigate(activePage + 1)}
          >
            {copy.project.nextPage}
          </Button>
        </nav>
      )}
      {analysis.diagnostics.length > 0 && (
        <output
          className="semantic-warnings"
          aria-label={copy.preview.referenceWarnings}
        >
          <strong>{copy.preview.checkReferences}</strong>
          <ul>
            {analysis.diagnostics.map((message) => (
              <li key={message}>
                {localizeDiagnosticMessage(message, locale)}
              </li>
            ))}
          </ul>
        </output>
      )}
      <div ref={content} className="contents" onClickCapture={followReference}>
        {pages.map((nodes, index) =>
          !paginated || index === activePage ? (
            <DocumentPage
              key={index}
              document={document}
              nodes={nodes}
              analysis={analysis}
              locale={locale}
              index={index}
              count={pages.length}
              resolveImageUrl={resolveImageUrl}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
