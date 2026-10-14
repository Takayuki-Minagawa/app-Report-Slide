'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const [language, setLanguage] = useState<'jpn+eng' | 'eng'>('jpn+eng');
  const [result, setResult] = useState<ExtractionResult | undefined>(
    node.attrs.figureEdit?.extraction,
  );
  const [text, setText] = useState(result?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const loading = new AbortController();
    let url: string | undefined;
    void sourceImage(node, resolveAssetUrl, loading.signal)
      .then((blob) => {
        if (loading.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      })
      .catch((cause) => {
        if (!loading.signal.aborted) setError(String(cause));
      });
    return () => {
      loading.abort();
      controller.current?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [node, resolveAssetUrl]);
  const recognize = async () => {
    if (!image || busy) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError('');
    setProgress(t('OCRを準備しています', 'Preparing OCR'));
    try {
      const { recognizeImage } = await import('@/src/ocr/ocr-engine');
      if (active.signal.aborted) return;
      const read = await recognizeImage(image.blob, {
        language,
        signal: active.signal,
        onProgress: (value) =>
          setProgress(`${value.status} ${Math.round(value.progress * 100)}%`),
      });
      if (active.signal.aborted) return;
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
      if (read.text.length > 100000)
        throw new Error(
          t(
            '文字数が上限を超えています。範囲を小さくしてください。',
            'Too much text. Select a smaller region.',
          ),
        );
      setResult(next);
      setText(read.text);
      setProgress(
        t(
          `認識スコア ${Math.round(read.confidence)} / 100（正確さを保証する値ではありません）`,
          `Recognition score ${Math.round(read.confidence)} / 100 (not an accuracy guarantee)`,
        ),
      );
    } catch (cause) {
      if (!active.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === active) {
        setBusy(false);
        controller.current = undefined;
      }
    }
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {t('画像の文字を読み取る', 'Read text from image')}
          </DialogTitle>
          <DialogDescription>
            {t(
              '現在の切り抜き範囲を日本語・英語OCRで読み取ります。画像は外部へ送信しません。原本と照合して修正してください。注釈は読み取りません。',
              'Read the current crop with Japanese/English OCR. Images stay in your browser. Compare and correct the result. Overlay annotations are excluded.',
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            {image && (
              <img
                src={image.url}
                alt={t('OCR対象の原画像', 'Original OCR region')}
                className="max-h-[60vh] w-full object-contain"
              />
            )}
          </div>
          <div className="space-y-3">
            <label className="block text-sm">
              {t('認識言語', 'OCR language')}
              <select
                aria-label={t('画像OCR言語', 'Image OCR language')}
                className="ml-2 rounded border p-2"
                value={language}
                disabled={busy}
                onChange={(event) =>
                  setLanguage(event.target.value as typeof language)
                }
              >
                <option value="jpn+eng">日本語 + English</option>
                <option value="eng">English</option>
              </select>
            </label>
            <Button disabled={!image || busy} onClick={() => void recognize()}>
              {t('画像OCRを実行', 'Run image OCR')}
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  controller.current?.abort();
                  setProgress(t('中止しました', 'Cancelled'));
                }}
              >
                {t('OCRを中止', 'Cancel OCR')}
              </Button>
            )}
            <output className="block text-xs">{progress}</output>
            <label className="block text-sm">
              {t('認識結果を修正', 'Correct recognized text')}
              <Textarea
                aria-label={t('画像OCRの認識結果', 'Image OCR result')}
                className="mt-1 min-h-64"
                value={text}
                maxLength={100000}
                disabled={busy || !result}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            {result && (
              <details>
                <summary>
                  {t('読み取り時の原文', 'Original recognized text')}
                </summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                  {result.rawText}
                </pre>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !result || !text.trim()}
                onClick={() => apply(true)}
              >
                {t(
                  '確認した本文を図の後に挿入',
                  'Insert reviewed text after figure',
                )}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !result}
                onClick={() => apply(false)}
              >
                {t('読み取り結果だけ保存', 'Save extraction only')}
              </Button>
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
