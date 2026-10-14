'use client';

import { useState } from 'react';
import { DocumentPage } from '@/components/preview/document-page';
import { documentTitle } from '@/src/document/model';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import type { AppLocale } from '@/src/i18n/messages';
import type { ImportedDocument } from '@/src/workspace/files';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Only model-rendered content is previewed. Imported HTML is never inserted into the UI. */
export function HtmlImportDialog({
  importResult,
  locale,
  onConfirm,
  onCancel,
}: {
  importResult: ImportedDocument | null;
  locale: AppLocale;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  if (!importResult?.htmlImport) return null;
  const ja = locale === 'ja';
  const { document, htmlImport, assets } = importResult;
  const pages = splitDocumentPages(document);
  const index = Math.min(pageIndex, pages.length - 1);
  const editable = htmlImport.kind === 'editable';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {ja ? 'HTML取込の確認' : 'Review HTML import'}
          </DialogTitle>
          <DialogDescription>
            {editable
              ? ja
                ? '編集用データを復元します。適用するまで現在の文書は変更されません。'
                : 'Restore the editable data. Your current document remains unchanged until you apply.'
              : ja
                ? '外部HTMLを編集できる文書に変換しました。ページと変換結果を確認してください。'
                : 'External HTML has been converted into an editable document. Review its pages and conversion report.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-auto space-y-3">
          <p>
            {documentTitle(document)} ·{' '}
            {document.type === 'slide' ? 'Slide' : 'Report'} ·{' '}
            {htmlImport.pageCount} {ja ? 'ページ' : 'pages'} ·{' '}
            {htmlImport.nodeCount} {ja ? '要素' : 'elements'}
          </p>
          {htmlImport.warnings.length > 0 && (
            <section
              className="rounded-md border bg-muted/40 p-3"
              aria-label={
                ja ? '変換結果・制限' : 'Conversion results and limitations'
              }
            >
              <h3 className="font-medium">
                {ja ? '変換結果・制限' : 'Conversion results and limitations'}
              </h3>
              <ul className="list-disc pl-5 text-xs space-y-1">
                {htmlImport.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="html-import-page">
              {ja ? 'プレビューするページ' : 'Preview page'}
            </label>
            <input
              id="html-import-page"
              type="number"
              min={1}
              max={pages.length}
              value={index + 1}
              className="w-20 rounded border px-2 py-1"
              onChange={(event) =>
                setPageIndex(
                  Math.max(
                    0,
                    Math.min(pages.length - 1, Number(event.target.value) - 1),
                  ),
                )
              }
            />
            <span>/ {pages.length}</span>
          </div>
          <div
            className="overflow-auto rounded border bg-muted p-3"
            aria-label={ja ? '取込プレビュー' : 'Import preview'}
          >
            <DocumentPage
              document={document}
              nodes={pages[index]}
              analysis={analyzeDocument(document)}
              locale={locale}
              index={index}
              count={pages.length}
              resolveImageUrl={(source) => assets.get(source) ?? source}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {ja ? 'キャンセル' : 'Cancel'}
          </Button>
          <Button onClick={onConfirm}>
            {ja ? '確認して取り込む' : 'Apply import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
