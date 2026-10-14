'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ExtractionResult } from '@/src/document/extraction';
import type { OpenPdf, PdfPageImage } from '@/src/pdf/pdf-renderer';
import {
  inferTextTable,
  numericTableValues,
  parseReviewTsv,
  positionedText,
  reviewedTableCsv,
  textInRegion,
  type PercentRegion,
} from '@/src/pdf/text-table';

export function PdfExtractionReview({
  session,
  page,
  rendered,
  crop,
  ja,
  disabled,
  onChange,
  onBusyChange,
}: {
  session?: OpenPdf;
  page: number;
  rendered?: PdfPageImage & { url: string };
  crop: PercentRegion;
  ja: boolean;
  disabled: boolean;
  onChange: (result: ExtractionResult | undefined) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = (j: string, e: string) => (ja ? j : e);
  const [result, setResult] = useState<ExtractionResult>();
  const [language, setLanguage] = useState<'jpn+eng' | 'eng'>('jpn+eng');
  const [method, setMethod] = useState<'auto' | 'ocr'>('auto');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [tsv, setTsv] = useState('');
  const [tsvError, setTsvError] = useState('');
  const request = useRef<{ revision: number; controller?: AbortController }>({
    revision: 0,
  });

  useEffect(() => {
    const current = request.current;
    const revision = ++current.revision;
    current.controller?.abort();
    void Promise.resolve().then(() => {
      if (current.revision !== revision) return;
      setResult(undefined);
      onChange(undefined);
      setBusy(false);
      onBusyChange(false);
      setError('');
      setTsvError('');
    });
    return () => {
      current.revision++;
      current.controller?.abort();
    };
  }, [
    session,
    page,
    rendered?.blob,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    onChange,
    onBusyChange,
  ]);

  const update = (next: ExtractionResult) => {
    setResult(next);
    setTsv(next.rows.map((row) => row.join('\t')).join('\n'));
    setTsvError('');
    onChange(next);
  };
  const read = async () => {
    if (!session || !rendered || busy || disabled) return;
    request.current.controller?.abort();
    const controller = new AbortController();
    const revision = ++request.current.revision;
    request.current.controller = controller;
    setBusy(true);
    onBusyChange(true);
    setProgress(0);
    setError('');
    setResult(undefined);
    onChange(undefined);
    try {
      let words = [] as Awaited<
        ReturnType<OpenPdf['extractPageText']>
      >['words'];
      let warnings: string[] = [];
      let usedMethod: ExtractionResult['method'] = 'pdf-text';
      let confidence: number | undefined;
      if (method === 'auto') {
        const text = await session.extractPageText(page);
        if (revision !== request.current.revision) return;
        words = textInRegion(text, crop);
        warnings = text.warnings;
      }
      if (!words.length) {
        usedMethod = 'ocr';
        const { recognizeImage } = await import('@/src/ocr/ocr-engine');
        if (revision !== request.current.revision) return;
        const recognized = await recognizeImage(rendered.blob, {
          language,
          rectangle: {
            left: Math.floor((crop.x * rendered.width) / 100),
            top: Math.floor((crop.y * rendered.height) / 100),
            width: Math.max(1, Math.floor((crop.width * rendered.width) / 100)),
            height: Math.max(
              1,
              Math.floor((crop.height * rendered.height) / 100),
            ),
          },
          signal: controller.signal,
          onProgress: (value) => {
            if (revision === request.current.revision)
              setProgress(value.progress);
          },
        });
        if (revision !== request.current.revision) return;
        words = recognized.words;
        confidence = recognized.confidence;
        warnings.push(
          t(
            'OCRの結果には読み誤りがあります。本文・数値・単位を原本と照合してください。',
            'OCR may misread text. Compare text, numbers and units with the original.',
          ),
        );
      }
      const rawText = positionedText(words);
      if (!rawText.trim())
        throw new Error(
          t(
            '文字が見つかりませんでした。範囲・解像度・言語を変更して試してください。',
            'No text found. Try another region, resolution or language.',
          ),
        );
      let inferred: ReturnType<typeof inferTextTable>;
      try {
        inferred = inferTextTable(words);
      } catch (cause) {
        inferred = {
          rows: [],
          warnings: [cause instanceof Error ? cause.message : String(cause)],
        };
      }
      const rows = inferred.rows;
      warnings.push(...inferred.warnings);
      const value: ExtractionResult = {
        mode: rows.length && rows[0].length > 1 ? 'table' : 'text',
        method: usedMethod,
        text: rawText,
        rawText,
        rows,
        rawRows: rows.map((row) => [...row]),
        numericValues: numericTableValues(rows, true),
        header: true,
        ...(usedMethod === 'ocr' ? { language, confidence } : {}),
        warnings,
      };
      if (revision === request.current.revision) update(value);
    } catch (cause) {
      if (revision === request.current.revision && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (revision === request.current.revision) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  };
  const cancel = () => {
    request.current.revision++;
    request.current.controller?.abort();
    setBusy(false);
    onBusyChange(false);
  };
  const downloadCsv = () => {
    if (!result) return;
    const blob = new Blob([reviewedTableCsv(result.rows, result.header)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pdf-page-${page}-reviewed.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="mt-3 rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t('文字・表を読み取る（OCR対応）', 'Read text and tables (OCR)')}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          '選択範囲の文字位置から表を推定します。PDFに文字がない場合は日本語・英語OCRを使います。原稿は外部に送信しません。初回OCRは辞書の読み込みに時間がかかります。',
          'Tables are proposed from text positions. Scans use Japanese/English OCR locally. Documents are never uploaded. The first OCR run loads language data.',
        )}
      </p>
      <div className="my-3 flex flex-wrap items-end gap-3 text-xs">
        <label className="grid gap-1">
          {t('読み取り方式', 'Recognition method')}
          <select
            aria-label={t('PDF読み取り方式', 'PDF recognition method')}
            value={method}
            disabled={busy || disabled}
            onChange={(event) =>
              setMethod(event.target.value as 'auto' | 'ocr')
            }
          >
            <option value="auto">
              {t('PDF文字を優先（なければOCR）', 'Use PDF text, otherwise OCR')}
            </option>
            <option value="ocr">{t('OCRで読み直す', 'Read using OCR')}</option>
          </select>
        </label>
        <label className="grid gap-1">
          {t('OCR言語', 'OCR language')}
          <select
            aria-label={t('PDFのOCR言語', 'PDF OCR language')}
            value={language}
            disabled={busy || disabled}
            onChange={(event) =>
              setLanguage(event.target.value as typeof language)
            }
          >
            <option value="jpn+eng">
              {t('日本語＋英語', 'Japanese + English')}
            </option>
            <option value="eng">{t('英語', 'English')}</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!rendered || !session || busy || disabled}
          onClick={() => void read()}
        >
          {t('選択範囲を読み取る', 'Read selected region')}
        </Button>
        {busy && (
          <>
            <output aria-live="polite">
              {t('読み取り中', 'Recognizing')} {Math.round(progress * 100)}%
            </output>
            <Button size="sm" variant="outline" onClick={cancel}>
              {t('読み取りを中止', 'Cancel recognition')}
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="grid gap-4 lg:grid-cols-[minmax(200px,0.7fr)_minmax(0,1fr)]">
          <div className="min-w-0 lg:sticky lg:top-2 lg:self-start">
            <strong className="text-xs">
              {t('読み取り範囲の原本', 'Original recognition region')}
            </strong>
            {rendered && (
              <svg
                aria-label={t('PDF読み取りの原本', 'PDF recognition original')}
                viewBox={`${(crop.x * rendered.width) / 100} ${(crop.y * rendered.height) / 100} ${(crop.width * rendered.width) / 100} ${(crop.height * rendered.height) / 100}`}
                className="mt-2 max-h-[55vh] w-full border bg-white"
              >
                <image
                  href={rendered.url}
                  width={rendered.width}
                  height={rendered.height}
                />
              </svg>
            )}
          </div>
          <fieldset disabled={disabled || busy} className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <strong>
                {result.method === 'pdf-text'
                  ? t('PDFの文字データ', 'PDF text data')
                  : `${t('OCR認識スコア', 'OCR recognition score')} ${Math.round(result.confidence ?? 0)} / 100`}
              </strong>
              <label>
                {t('挿入形式', 'Insert as')}{' '}
                <select
                  aria-label={t('PDF抽出の挿入形式', 'PDF extraction format')}
                  value={result.mode}
                  onChange={(event) =>
                    update({
                      ...result,
                      mode: event.target.value as ExtractionResult['mode'],
                    })
                  }
                >
                  <option value="text">
                    {t('編集できる本文', 'Editable text')}
                  </option>
                  <option value="table" disabled={!result.rows.length}>
                    {t('編集できる表', 'Editable table')}
                  </option>
                </select>
              </label>
            </div>
            {result.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-200">
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
            {result.mode === 'text' ? (
              <label className="grid gap-1 text-xs">
                {t(
                  '原本と照合して本文を修正',
                  'Review and correct text against the original',
                )}
                <Textarea
                  aria-label={t('PDF抽出本文', 'Extracted PDF text')}
                  value={result.text}
                  maxLength={100000}
                  className="max-h-72 min-h-32 font-mono"
                  onChange={(event) =>
                    update({ ...result, text: event.target.value })
                  }
                />
              </label>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={result.header}
                      aria-label={t(
                        'PDF表の先頭行を見出しにする',
                        'Use first PDF table row as header',
                      )}
                      onChange={(event) =>
                        update({
                          ...result,
                          header: event.target.checked,
                          numericValues: numericTableValues(
                            result.rows,
                            event.target.checked,
                          ),
                        })
                      }
                    />
                    {t('先頭行を見出しにする', 'First row is a header')}
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(tsvError)}
                    onClick={() => {
                      const rows = result.rows.map((row, ri) =>
                        row.map((cell, ci) =>
                          result.numericValues[ri][ci] === null
                            ? cell
                            : String(result.numericValues[ri][ci]),
                        ),
                      );
                      update({
                        ...result,
                        rows,
                        numericValues: numericTableValues(rows, result.header),
                      });
                    }}
                  >
                    {t('数値候補を表に反映', 'Apply numeric values')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(tsvError)}
                    onClick={downloadCsv}
                  >
                    {t('確認中の表をCSV保存', 'Save reviewed CSV')}
                  </Button>
                  <span>
                    {result.rows.length} {t('行', 'rows')} ×{' '}
                    {result.rows[0]?.length ?? 0} {t('列', 'columns')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    '数値候補は全角数字・桁区切り・負号・指数表記を変換します。単位や％は文字のまま保持します。結合セル・複数行見出しはTSVを修正してください。',
                    'Numeric candidates normalize full-width digits, thousands separators, minus signs and exponents. Units and percentages remain text. Correct merged cells or multiline headers in TSV.',
                  )}
                </p>
                <div className="max-h-80 overflow-auto rounded border">
                  <table
                    className="w-full border-collapse text-xs"
                    aria-label={t(
                      'PDF表の確認グリッド',
                      'PDF table review grid',
                    )}
                  >
                    <tbody>
                      {result.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="min-w-28 border p-1 align-top"
                            >
                              <Input
                                aria-label={`${t('PDF表', 'PDF table')} ${ri + 1}-${ci + 1}`}
                                value={cell}
                                maxLength={2000}
                                className={
                                  result.header && ri === 0
                                    ? 'font-semibold'
                                    : ''
                                }
                                onChange={(event) => {
                                  const rows = result.rows.map((r, rIndex) =>
                                    r.map((v, cIndex) =>
                                      rIndex === ri && cIndex === ci
                                        ? event.target.value
                                        : v,
                                    ),
                                  );
                                  update({
                                    ...result,
                                    rows,
                                    numericValues: numericTableValues(
                                      rows,
                                      result.header,
                                    ),
                                  });
                                }}
                              />
                              <div className="mt-1 max-w-60 break-all text-[10px] text-muted-foreground">
                                {t('原文', 'Original')}:{' '}
                                {result.rawRows[ri]?.[ci] ?? '—'}
                              </div>
                              {result.numericValues[ri][ci] !== null && (
                                <div className="text-[10px] text-blue-700 dark:text-blue-300">
                                  {t('数値', 'Number')}:{' '}
                                  {result.numericValues[ri][ci]}
                                </div>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs">
                    {t('TSVで行・列を修正', 'Edit rows and columns as TSV')}
                  </summary>
                  <Textarea
                    aria-label={t('PDF表TSV', 'PDF table TSV')}
                    value={tsv}
                    maxLength={100000}
                    className="my-2 max-h-48 min-h-24 whitespace-pre font-mono"
                    onChange={(event) => {
                      const value = event.target.value;
                      setTsv(value);
                      try {
                        const rows = parseReviewTsv(value);
                        const next = {
                          ...result,
                          rows,
                          numericValues: numericTableValues(
                            rows,
                            result.header,
                          ),
                        };
                        setResult(next);
                        onChange(next);
                        setTsvError('');
                      } catch (cause) {
                        setTsvError(
                          cause instanceof Error
                            ? cause.message
                            : String(cause),
                        );
                        onChange(undefined);
                      }
                    }}
                  />
                  {tsvError && (
                    <p role="alert" className="text-xs text-destructive">
                      {tsvError}
                    </p>
                  )}
                </details>
              </>
            )}
            <p className="text-xs">
              {t(
                'ページ画像を見ながら修正してください。「原本と確認済みの内容を挿入」で、元PDF・ページ画像・読み取り原文と確認後の値を一緒に保存します。',
                'Compare with the page image before insertion. Insert original and reviewed content saves the original PDF, image, raw recognition and reviewed values together.',
              )}
            </p>
          </fieldset>
        </div>
      )}
    </details>
  );
}
