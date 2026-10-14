'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData } from '@/src/document/model';
import {
  officeFeatureWarnings,
  referencedLocalImages,
} from '@/src/export/format-capabilities';

export function SaveFormatDialog({
  document,
  project,
}: {
  document: DocumentData;
  project: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const title = ja ? '保存形式の違い' : 'Save format details';
  const warnings = open ? officeFeatureWarnings(document, locale) : [];
  const localAssets = open ? referencedLocalImages(document) : [];
  const rows = ja
    ? [
        [
          'HTML',
          '本文・表・グラフデータ・SVG編集情報・原画像・切り抜き・注釈・出典・配置・補足を保持。取り込んだ画像とPDF原本全体を埋め込み、別のブラウザーでPDFのページ・切り抜きも選び直せます。外部URLの画像はリンクのままです。',
        ],
        [
          'ZIP',
          '文書と取り込んだ画像・PDF原本全体を一緒に保存。PDFのページ選択・切り抜き情報も保持します。章別ReportにはプロジェクトZIPを使います。',
        ],
        [
          'JSON / Markdown',
          '編集データ・PDFのページ選択・切り抜き情報は保持しますが、ローカル画像とPDF原本ファイルは同梱しません。再編集には元ファイルも必要です。Markdownの拡張設定はYAML・KUMI専用ブロック・属性に保存します。',
        ],
        [
          'PPTX / Word',
          'Office側で本文・表・グラフデータを編集できます。KUMIへの再読込には対応していません。以下の対象は専用情報や見た目が変わります。',
        ],
        [
          'PDF',
          '完成ページを画像化して保存します。文字の選択・検索やKUMIでの再編集はできません。検索できるPDFにはHTMLを開いて「印刷／PDF保存」を使用してください。',
        ],
      ]
    : [
        [
          'HTML',
          'Keeps content, tables, chart data, SVG source, originals, crops, annotations, references, layouts and supplements. Imported images and complete PDF originals are embedded, so PDF pages and crops can be selected again after reopening. Remote images remain links.',
        ],
        [
          'ZIP',
          'Stores the document, imported images and complete PDF originals, including page selection and crop settings. Use Project ZIP for chapter-based reports.',
        ],
        [
          'JSON / Markdown',
          'Retains editing data, PDF page selection and crop settings, but does not bundle local images or PDF originals. Keep the source files for re-editing. Markdown uses YAML, KUMI blocks and attributes for advanced structures.',
        ],
        [
          'PPTX / Word',
          'Text, tables and chart data can be edited in Office; importing back into KUMI is unsupported. The items below lose KUMI-specific information or appearance.',
        ],
        [
          'PDF',
          'Rasterized pages; no searchable text or KUMI re-editing. For searchable text, open HTML and use Print / Save PDF.',
        ],
      ];
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {title}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {ja
                ? '図表を含む編集用の原本はHTMLまたはZIPで保存してください。'
                : 'Use HTML or ZIP for an editable original with figures.'}
            </DialogDescription>
          </DialogHeader>
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="p-2">{ja ? '形式' : 'Format'}</th>
                <th className="p-2">
                  {ja ? '保存・再編集できる範囲' : 'Preservation and editing'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([format, detail]) => (
                <tr key={format} className="border-t">
                  <th className="p-2 align-top">{format}</th>
                  <td className="p-2">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {project && (
            <p className="text-xs">
              {ja
                ? '全体HTMLは出力対象の章を結合します。章構成と除外章も残す場合はプロジェクトZIPを使用してください。'
                : 'Full HTML combines included chapters. Project ZIP also retains chapter structure and excluded chapters.'}
            </p>
          )}
          {localAssets.length > 0 && (
            <section className="text-xs">
              <h3 className="font-medium">
                {ja
                  ? `JSON／Markdownでは別途必要な画像・PDF原本（${localAssets.length}件）`
                  : `Images and PDF originals needed separately for JSON / Markdown (${localAssets.length})`}
              </h3>
              <ul className="list-disc pl-5">
                {localAssets.map((src) => (
                  <li key={src} className="break-all">
                    {src}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {warnings.length > 0 && (
            <section className="space-y-2 text-xs">
              <h3 className="font-medium">
                {ja
                  ? 'この文書をOfficeへ出力する際の変更点'
                  : 'Office changes for this document'}
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
