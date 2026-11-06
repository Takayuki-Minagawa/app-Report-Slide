'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { referencedAssets } from '@/src/document/assets';
import type { DocumentData } from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import {
  analyzeDocument,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import { waitForReportPagination } from '@/src/export/pagination-ready';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { AppLocale } from '@/src/i18n/messages';
import {
  statusMessageText,
  WorkspaceStatusError,
} from '@/src/workspace/status';

interface PreviewRequest {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
  locale: AppLocale;
  attempt: number;
}

type PreviewStatus =
  | { request: PreviewRequest; kind: 'ready'; pageCount: number }
  | { request: PreviewRequest; kind: 'error'; cause: unknown };

function errorMessage(cause: unknown): string | undefined {
  // Errors rejected by the iframe belong to another JavaScript realm.
  if (
    cause &&
    typeof cause === 'object' &&
    'message' in cause &&
    typeof cause.message === 'string'
  )
    return cause.message;
  return typeof cause === 'string' ? cause : undefined;
}

/** The same fixed paper layout is used for preview, exported HTML and PDF. */
export function PhysicalReportPreview({
  document,
  resolveImageUrl,
  analysis: providedAnalysis,
}: {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
  analysis?: DocumentAnalysis;
}) {
  const { copy, locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(
    () => ({ document, resolveImageUrl, locale, attempt }),
    [document, resolveImageUrl, locale, attempt],
  );
  const activeRequest = useRef<PreviewRequest | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const waitingDocument = useRef<Document | null>(null);
  const [output, setOutput] = useState<{
    request: PreviewRequest;
    html: string;
  }>();
  const [status, setStatus] = useState<PreviewStatus>();
  // Ignore old output immediately during render, before the next effect runs.
  const currentOutput = output?.request === request ? output : undefined;
  const currentStatus = status?.request === request ? status : undefined;
  const ready = currentStatus?.kind === 'ready';
  const failed = currentStatus?.kind === 'error';
  const [width] = pageDimensions(resolvePageSettings(document.metadata));
  const analysis = useMemo(
    () => providedAnalysis ?? analyzeDocument(document),
    [document, providedAnalysis],
  );

  useEffect(() => {
    let cancelled = false;
    activeRequest.current = request;
    void (async () => {
      const assets = new Map(
        referencedAssets(
          request.document.children,
          request.document.metadata,
        ).map(({ source }) => [
          source,
          request.resolveImageUrl?.(source) ?? source,
        ]),
      );
      const { exportReportHtml } = await import('@/src/export/report-html');
      if (cancelled || activeRequest.current !== request) return;
      const result = await exportReportHtml(
        request.document,
        assets,
        request.locale,
      );
      if (!cancelled && activeRequest.current === request)
        setOutput({ request, html: result.html });
    })().catch((cause: unknown) => {
      if (!cancelled && activeRequest.current === request)
        setStatus({ request, kind: 'error', cause });
    });
    return () => {
      cancelled = true;
      if (activeRequest.current === request) activeRequest.current = null;
    };
  }, [request]);

  const loaded = async () => {
    const renderedDocument = frame.current?.contentDocument;
    if (
      !renderedDocument ||
      !currentOutput ||
      activeRequest.current !== request ||
      waitingDocument.current === renderedDocument
    )
      return;
    // A newly mounted frame can load its initial about:blank before srcDoc.
    // Only the exported document carries the pagination lifecycle marker.
    if (
      !['pending', 'ready', 'error'].includes(
        renderedDocument.documentElement.dataset.kumiPagination ?? '',
      )
    )
      return;
    waitingDocument.current = renderedDocument;
    try {
      const result = await waitForReportPagination(renderedDocument);
      if (
        activeRequest.current !== request ||
        frame.current?.contentDocument !== renderedDocument
      )
        return;
      setStatus({ request, kind: 'ready', pageCount: result.pageCount });
    } catch (cause) {
      if (
        activeRequest.current === request &&
        frame.current?.contentDocument === renderedDocument
      )
        setStatus({ request, kind: 'error', cause });
    }
  };

  return (
    <div className="preview-pages min-w-0" aria-busy={!ready && !failed}>
      {!failed && (
        <output className="preview-page-summary" aria-live="polite">
          {ready
            ? ja
              ? `${currentStatus.pageCount} ページ（組版後）`
              : `${currentStatus.pageCount} physical page${currentStatus.pageCount === 1 ? '' : 's'}`
            : ja
              ? '用紙に合わせて組版しています…'
              : 'Laying out the report for print…'}
        </output>
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
      {failed && (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            {ja
              ? 'レポートを組版できませんでした。画像や書式を確認して、もう一度お試しください。'
              : 'The report could not be laid out. Check its images and formatting, then try again.'}
            {currentStatus.cause instanceof WorkspaceStatusError ? (
              <span className="block">
                {statusMessageText(currentStatus.cause.status, copy, locale)}
              </span>
            ) : (
              <span className="block">{errorMessage(currentStatus.cause)}</span>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {ja ? '再試行' : 'Try again'}
          </Button>
        </div>
      )}
      {currentOutput && !failed && (
        <div className="w-full min-w-0 overflow-x-auto">
          <iframe
            ref={frame}
            title={
              ja ? '組版後のレポートプレビュー' : 'Paginated report preview'
            }
            sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
            srcDoc={currentOutput.html}
            onLoad={() => void loaded()}
            aria-hidden={!ready}
            tabIndex={ready ? undefined : -1}
            className="mx-auto block rounded border bg-white"
            style={{
              // A fixed viewport preserves line wrapping when the panel resizes.
              width: `calc(${width}mm + 64px)`,
              maxWidth: 'none',
              height: '75vh',
              visibility: ready ? 'visible' : 'hidden',
            }}
          />
        </div>
      )}
    </div>
  );
}
