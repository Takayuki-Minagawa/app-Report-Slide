'use client';

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The named image scroll region must receive keyboard focus so enlarged images can be scrolled with arrow keys. */

import { useEffect, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FigureNode } from '@/src/document/model';
import {
  editableFigureSvgSource,
  svgDataUrl,
  type FigureEdit,
} from '@/src/document/figure-edit';
import type { ExtractionResult } from '@/src/document/extraction';
import { resolveSafeImageUrl } from '@/src/security/resource-url';
import { sanitizeSvgSource } from '@/src/security/svg-source';

async function sourceImage(
  node: FigureNode,
  resolve: (source: string) => string,
  signal: AbortSignal,
): Promise<Blob> {
  const svg = editableFigureSvgSource(node.attrs.figureEdit ?? undefined);
  const source = svg
    ? svgDataUrl(sanitizeSvgSource(svg).source)
    : resolveSafeImageUrl(node.attrs.src, resolve);
  if (!source) throw new Error('画像を読み込めません。');
  const response = await fetch(source, { signal });
  if (!response.ok)
    throw new Error('画像を読み込めません。ローカル画像を取り込んでください。');
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024)
    throw new Error('OCR画像は20 MiB以内にしてください。');
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const crop = node.attrs.figureEdit?.crop ?? {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    const width = (img.naturalWidth * crop.width) / 100;
    const height = (img.naturalHeight * crop.height) / 100;
    if (!width || !height) throw new Error('画像の寸法が不正です。');
    const scale = Math.min(
      1,
      Math.sqrt(8_000_000 / (width * height)),
      4096 / Math.max(width, height),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      img,
      (img.naturalWidth * crop.x) / 100,
      (img.naturalHeight * crop.y) / 100,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    try {
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error('画像変換に失敗しました。')),
          'image/png',
        ),
      );
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function OcrImageDialog({
  node,
  resolveAssetUrl,
  onApply,
  onClose,
}: {
  node: FigureNode;
  resolveAssetUrl: (source: string) => string;
  onApply: (next: FigureEdit, insertText: boolean) => void;
  onClose: () => void;
}) {
  const ja = useAppPreferences().locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState('');
  const [imageRevision, setImageRevision] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [language, setLanguage] = useState<'jpn+eng' | 'eng'>(
    node.attrs.figureEdit?.extraction?.language === 'eng' ? 'eng' : 'jpn+eng',
  );
  const [original] = useState(() => node.attrs.figureEdit?.extraction);
  const [result, setResult] = useState<ExtractionResult | undefined>(original);
  const [text, setText] = useState(result?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressValue, setProgressValue] = useState(0);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'close' | 'recognize'>();
  const continueButton = useRef<HTMLButtonElement>(null);
  const resultInput = useRef<HTMLTextAreaElement>(null);
  const resumeTextFocus = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const hasUnsavedChanges = Boolean(
    result && (result !== original || text !== (original?.text ?? '')),
  );
  useEffect(() => {
    if (pendingAction) continueButton.current?.focus();
    else if (!busy && resumeTextFocus.current) {
      resumeTextFocus.current = false;
      resultInput.current?.focus();
    }
  }, [pendingAction, busy]);
  useEffect(() => {
    const loading = new AbortController();
    let url: string | undefined;
    // Defer the async load's initial state transition too, and skip it if the
    // dialog/source changed before this effect could start loading.
    void Promise.resolve().then(async () => {
      if (loading.signal.aborted) return;
      setImageLoading(true);
      setImageError('');
      setImage(undefined);
      try {
        const blob = await sourceImage(node, resolveAssetUrl, loading.signal);
        if (loading.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
        setImageLoading(false);
      } catch (cause) {
        if (!loading.signal.aborted) {
          setImageError(cause instanceof Error ? cause.message : String(cause));
          setImageLoading(false);
        }
      }
    });
    return () => {
      loading.abort();
      controller.current?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [node, resolveAssetUrl, imageRevision]);
  const recognize = async () => {
    if (!image || busy) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setProgressValue(0);
    setProgress(t('OCRを準備しています', 'Preparing OCR'));
    try {
      const { recognizeImage } = await import('@/src/ocr/ocr-engine');
      if (active.signal.aborted) return;
      const read = await recognizeImage(image.blob, {
        language,
        signal: active.signal,
        onProgress: (value) => {
          if (active.signal.aborted) return;
          setProgressValue(value.progress);
          const englishStages: Record<string, string> = {
            OCRエンジンを準備中: 'Preparing OCR engine',
            OCRエンジンを起動中: 'Starting OCR engine',
            読み取り用の言語データを準備中: 'Loading language data',
            文字の読み取りを準備中: 'Preparing recognition',
            文字を読み取り中: 'Reading text',
            文字の読み取りが完了しました: 'Recognition complete',
          };
          setProgress(
            `${ja ? value.status : (englishStages[value.status] ?? 'Reading text')} ${Math.round(value.progress * 100)}%`,
          );
        },
      });
      if (active.signal.aborted) return;
      if (!read.text.trim())
        throw new Error(
          t(
            '文字が見つかりませんでした。認識言語や図の切り抜き範囲を確認して再実行してください。前の結果は保持しています。',
            'No text found. Check the language or crop and try again. Previous results have been kept.',
          ),
        );
      if (read.text.length > 100000)
        throw new Error(
          t(
            '文字数が上限を超えています。範囲を小さくしてください。前の結果は保持しています。',
            'Too much text. Select a smaller region. Previous results have been kept.',
          ),
        );
      const next: ExtractionResult = {
        mode: 'text',
        method: 'ocr',
        text: read.text,
        rawText: read.text,
        rows: [],
        rawRows: [],
        numericValues: [],
        header: false,
        language,
        confidence: read.confidence,
        warnings: [],
      };
      setResult(next);
      setText(read.text);
      setProgress(
        t(
          `読み取り完了・認識スコア ${Math.round(read.confidence)} / 100（正確さを保証する値ではありません）`,
          `Complete · Recognition score ${Math.round(read.confidence)} / 100 (not an accuracy guarantee)`,
        ),
      );
    } catch (cause) {
      if (!active.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setProgress(
          t(
            '読み取りに失敗しました。再実行できます。',
            'Reading failed. You can try again.',
          ),
        );
      }
    } finally {
      if (controller.current === active) {
        setBusy(false);
        controller.current = undefined;
      }
    }
  };
  const cancelOcr = () => {
    controller.current?.abort();
    setProgress(
      t(
        '中止しました。前の結果は保持しています。',
        'Cancelled. Previous results have been kept.',
      ),
    );
  };
  const continueEditing = (trigger: HTMLElement | null) => {
    // Move off the disappearing confirmation button before removing it. The
    // dialog focus manager otherwise restores focus to the popup after ours.
    trigger
      ?.closest<HTMLElement>('[role="dialog"]')
      ?.focus({ preventScroll: true });
    resumeTextFocus.current = true;
    setPendingAction(undefined);
  };
  const requestClose = () => {
    // Stop first: the confirmation must not let an active worker replace the
    // draft while the user decides whether to keep editing or close.
    if (busy) cancelOcr();
    if (pendingAction) {
      continueEditing(continueButton.current);
    } else if (hasUnsavedChanges) {
      setPendingAction('close');
    } else {
      onClose();
    }
  };
  const requestRecognize = () => {
    if (hasUnsavedChanges) setPendingAction('recognize');
    else void recognize();
  };
  const apply = (insertText: boolean) => {
    if (!result) return;
    try {
      onApply(
        {
          ...node.attrs.figureEdit,
          version: 1,
          extraction: { ...result, mode: 'text', text },
        },
        insertText,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const blocked = busy || Boolean(pendingAction);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        closeLabel={t('画像OCRを閉じる', 'Close image OCR')}
        className="flex max-h-[90vh] flex-col overflow-clip sm:max-w-5xl"
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>
            {t('画像の文字を読み取る', 'Read text from image')}
          </DialogTitle>
          <DialogDescription>
            {t(
              '1. 認識言語を選んで実行 → 2. 原画像と照合して修正 → 3. 本文に挿入、または結果だけ保存。現在の切り抜き範囲を読み取ります。画像は外部へ送信しません。注釈は読み取りません。',
              '1. Choose a language and run OCR → 2. Compare and correct → 3. Insert text or save the result. Reads the current crop. Images stay in your browser. Overlay annotations are excluded.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-auto md:grid-cols-2">
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <label className="flex shrink-0 items-center justify-between gap-2 text-sm">
              {t('原画像（読み取り範囲）', 'Original image (OCR region)')}
              <select
                aria-label={t('OCR原画像の表示倍率', 'OCR image zoom')}
                className="rounded border p-1.5"
                value={zoom}
                disabled={!image}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {[100, 150, 200, 300].map((value) => (
                  <option key={value} value={value}>
                    {value}%{value === 100 ? t('（全体）', ' (fit)') : ''}
                  </option>
                ))}
              </select>
            </label>
            <section
              aria-label={t('OCR原画像の確認', 'Review OCR image')}
              tabIndex={0}
              className="max-h-60 min-h-32 overflow-auto rounded border bg-muted/30 md:max-h-[46vh]"
            >
              {imageLoading && (
                <output className="block p-4 text-sm">
                  {t(
                    'OCR対象の画像を準備しています…',
                    'Preparing the OCR image…',
                  )}
                </output>
              )}
              {imageError && (
                <div className="space-y-2 p-4">
                  <p role="alert" className="text-sm text-destructive">
                    {imageError}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setImageRevision((revision) => revision + 1)}
                  >
                    {t('原画像を再読み込み', 'Reload original image')}
                  </Button>
                </div>
              )}
              {image && (
                <img
                  src={image.url}
                  alt={t('OCR対象の原画像', 'Original OCR region')}
                  className="max-w-none"
                  style={{ width: `${zoom}%` }}
                />
              )}
            </section>
            <p className="text-xs text-muted-foreground">
              {t(
                '小さい文字は倍率を上げて確認できます。拡大後は画像の枠内をスクロールしてください。',
                'Increase zoom to check small text. Scroll inside the image frame when zoomed in.',
              )}
            </p>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm">
                {t('認識言語', 'OCR language')}
                <select
                  aria-label={t('画像OCR言語', 'Image OCR language')}
                  className="ml-2 rounded border p-2"
                  value={language}
                  disabled={blocked}
                  onChange={(event) =>
                    setLanguage(event.target.value as typeof language)
                  }
                >
                  <option value="jpn+eng">日本語 + English</option>
                  <option value="eng">English</option>
                </select>
              </label>
              <Button disabled={!image || blocked} onClick={requestRecognize}>
                {result
                  ? t('画像OCRを再実行', 'Run image OCR again')
                  : t('画像OCRを実行', 'Run image OCR')}
              </Button>
              {busy && (
                <Button variant="outline" onClick={cancelOcr}>
                  {t('OCRを中止', 'Cancel OCR')}
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <output aria-live="polite" className="block text-xs">
                {progress ||
                  (result
                    ? t(
                        '保存済みの結果を表示しています。修正後に保存できます。',
                        'Showing the saved result. Edit it and save your changes.',
                      )
                    : t(
                        '実行すると、ここに認識結果が表示されます。',
                        'Run OCR to display recognized text here.',
                      ))}
              </output>
              {busy && (
                <progress
                  aria-label={t('画像OCRの進捗', 'Image OCR progress')}
                  value={progressValue}
                  max={1}
                  className="block h-2 w-full"
                />
              )}
            </div>
            <label className="flex min-h-0 flex-col gap-1 text-sm">
              {t('認識結果を修正', 'Correct recognized text')}
              <Textarea
                ref={resultInput}
                aria-label={t('画像OCRの認識結果', 'Image OCR result')}
                className="min-h-40 resize-y md:h-[24vh] md:min-h-28"
                value={text}
                maxLength={100000}
                disabled={blocked || !result}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {result && (
              <details>
                <summary className="cursor-pointer text-xs">
                  {t('読み取り時の原文', 'Original recognized text')}
                </summary>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">
                  {result.rawText}
                </pre>
              </details>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="shrink-0 text-sm text-destructive">
            {error}
          </p>
        )}
        {pendingAction && (
          <div
            role="alert"
            className="shrink-0 space-y-2 rounded border bg-muted p-3"
          >
            <p className="text-sm">
              {pendingAction === 'close'
                ? t(
                    '読み取り結果に未保存の変更があります。閉じるとこの変更は失われます。',
                    'The OCR result has unsaved changes. Closing will discard them.',
                  )
                : t(
                    '再実行すると、未保存の読み取り結果と修正内容を新しい結果に置き換えます。中止・失敗時は現在の内容を保持します。',
                    'Running OCR again will replace the unsaved result and corrections. Cancellation or failure keeps the current text.',
                  )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                ref={continueButton}
                variant="outline"
                onClick={(event) => continueEditing(event.currentTarget)}
              >
                {t('編集を続ける', 'Keep editing')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const action = pendingAction;
                  setPendingAction(undefined);
                  if (action === 'close') onClose();
                  else void recognize();
                }}
              >
                {pendingAction === 'close'
                  ? t('変更を破棄して閉じる', 'Discard changes and close')
                  : t(
                      '新しい認識結果に置き換える',
                      'Replace with a new OCR result',
                    )}
              </Button>
            </div>
          </div>
        )}
        <DialogFooter className="shrink-0 flex-wrap sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto sm:max-w-60">
            {t(
              '結果だけ保存すると本文は増えません。本文に挿入すると図の後に段落が追加されます。',
              'Saving only keeps the result with the image. Inserting adds paragraphs after the figure.',
            )}
          </p>
          <Button
            variant="outline"
            disabled={Boolean(pendingAction)}
            onClick={requestClose}
          >
            {busy
              ? t('中止して閉じる', 'Cancel and close')
              : t('閉じる', 'Close dialog')}
          </Button>
          <Button
            variant="outline"
            disabled={blocked || !result}
            onClick={() => apply(false)}
          >
            {t('読み取り結果だけ保存', 'Save extraction only')}
          </Button>
          <Button
            disabled={blocked || !result || !text.trim()}
            onClick={() => apply(true)}
          >
            {t(
              '確認した本文を図の後に挿入',
              'Insert reviewed text after figure',
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
