'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DocumentData } from '@/src/document/model';
import type { AssetUrls } from '@/src/workspace/files';
import type { PrintSnapshot } from '@/src/export/print-html';

export interface OutputSnapshot {
  document: DocumentData;
  assets: AssetUrls;
}

export function OutputPreviewDialog({
  snapshot,
  onClose,
}: {
  snapshot: OutputSnapshot;
  onClose: () => void;
}) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [mode, setMode] = useState<'html' | 'print'>('print');
  const [result, setResult] = useState<{
    print: PrintSnapshot;
    html: string;
  }>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ exportPrintHtml }, exporter] = await Promise.all([
        import('@/src/export/print-html'),
        snapshot.document.type === 'slide'
          ? import('@/src/export/slide-html').then((m) => m.exportSlideHtml)
          : import('@/src/export/report-html').then((m) => m.exportReportHtml),
      ]);
      const [print, html] = await Promise.all([
        exportPrintHtml(snapshot.document, snapshot.assets, locale),
        exporter(snapshot.document, snapshot.assets, locale),
      ]);
      if (!cancelled) setResult({ print, html: html.html });
    })().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot, locale]);
  const loaded = async () => {
    const doc = frame.current?.contentDocument;
    if (!doc || !result) return;
    setReady(false);
    try {
      await doc.fonts.ready;
      await Promise.all(
        [...doc.images].map((image) => image.decode().catch(() => undefined)),
      );
      if (frame.current?.contentDocument !== doc) return;
      const messages: string[] = [];
      const broken = [...doc.images].filter(
        (image) => !image.naturalWidth,
      ).length;
      if (broken)
        messages.push(
          ja
            ? `${broken} 件の画像を読み込めません。`
            : `${broken} images could not be loaded.`,
        );
      if (mode === 'print') {
        const overflow = [
          ...doc.querySelectorAll<HTMLElement>('.slide-preview'),
        ]
          .filter(
            (page) =>
              page.scrollHeight > page.clientHeight + 2 ||
              page.scrollWidth > page.clientWidth + 2,
          )
          .map((page) => page.dataset.page);
        if (overflow.length)
          messages.push(
            ja
              ? `ページ ${overflow.join(', ')} は用紙からはみ出しています。内容・密度・表分割を調整してください。`
              : `Pages ${overflow.join(', ')} overflow the sheet. Adjust content, density or split tables.`,
          );
      }
      if (
        mode === 'print' &&
        [...doc.querySelectorAll<HTMLElement>('.preview-table-wrap')].some(
          (table) => table.scrollWidth > table.clientWidth + 2,
        )
      )
        messages.push(
          ja
            ? '表の幅が用紙を超えています。列幅を調整して印刷プレビューを確認してください。'
            : 'A table exceeds the sheet width. Adjust column widths and check print preview.',
        );
      if (mode === 'print') {
        const clipped = [
          ...doc.querySelectorAll<HTMLElement>('.print-page *'),
        ].some((element) => {
          if (
            element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
            element.closest('.katex-mathml')
          )
            return false;
          const style = doc.defaultView?.getComputedStyle(element);
          if (!style) return false;
          const clips = (value: string) =>
            /^(auto|scroll|hidden|clip)$/.test(value);
          return (
            (element.clientWidth > 0 &&
              clips(style.overflowX) &&
              element.scrollWidth > element.clientWidth + 2) ||
            (element.clientHeight > 0 &&
              clips(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 2)
          );
        });
        if (clipped)
          messages.push(
            ja
              ? '数式・コード・図表などに、表示範囲で切れる内容があります。幅・改行・配置を修正してから保存してください。'
              : 'Some math, code or figures are clipped. Adjust widths, line breaks or layout before saving.',
          );
      }
      setWarnings(messages);
      setReady(true);
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col sm:max-w-[96vw]">
        <DialogHeader>
          <DialogTitle>
            {ja
              ? '出力比較・検索できるPDF'
              : 'Output comparison / searchable PDF'}
          </DialogTitle>
          <DialogDescription>
            {ja
              ? 'HTML表示と印刷用紙を切り替えて確認できます。「印刷／PDF保存」で保存先をPDFにしてください。最終的な改ページはブラウザーの印刷プレビューで確認します。'
              : 'Compare HTML and print layouts. Choose Save as PDF in the print dialog. Check final pagination in your browser’s print preview.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {(['html', 'print'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? 'default' : 'outline'}
              aria-pressed={mode === value}
              onClick={() => {
                if (mode === value) return;
                setReady(false);
                setWarnings([]);
                setMode(value);
              }}
            >
              {value === 'html' ? 'HTML' : ja ? '印刷用紙' : 'Print sheets'}
            </Button>
          ))}
          <Button
            disabled={!ready || mode !== 'print'}
            onClick={() => {
              frame.current?.contentWindow?.focus();
              frame.current?.contentWindow?.print();
            }}
          >
            {ja ? '印刷／PDF保存' : 'Print / Save PDF'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {result
              ? `${result.print.pageCount} ${ja ? '原稿ページ' : 'source pages'}`
              : ja
                ? '出力を準備しています…'
                : 'Preparing output…'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {ja
            ? '本文・表・数式は文字、グラフ・SVG図はベクターのまま印刷します。写真・PDFから切り出した図などの画像内文字は検索対象になりません。印刷設定ではヘッダー・フッターをオフ、背景のグラフィックをオンにしてください。'
            : 'Text, tables, math and SVG remain native print content. Text within photos and PDF page images is not searchable. Disable browser headers/footers and enable background graphics.'}
        </p>
        {result && result.print.rasterElements.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">
              {ja ? '画像として印刷される要素' : 'Raster image elements'} (
              {result.print.rasterElements.length})
            </summary>
            <ul className="max-h-24 overflow-auto pl-4">
              {result.print.rasterElements.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          </details>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {warnings.map((warning, index) => (
          <output key={index} className="text-xs text-amber-700">
            {warning}
          </output>
        ))}
        {result && (
          <iframe
            key={mode}
            ref={frame}
            title={ja ? '出力プレビュー' : 'Output preview'}
            sandbox={
              mode === 'html'
                ? 'allow-same-origin allow-modals allow-scripts allow-popups'
                : 'allow-same-origin allow-modals'
            }
            srcDoc={mode === 'print' ? result.print.html : result.html}
            onLoad={() => void loaded()}
            className="min-h-0 flex-1 rounded border bg-white"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
