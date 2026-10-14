'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DocumentMetadata, FigureNode } from '@/src/document/model';
import { createNodeId } from '@/src/document/model';
import {
  conceptDiagramSvg,
  figureEditSchema,
  figureOriginLabels,
  figureOrigins,
  figureReferences,
  figureReferenceSchema,
  readFigureEdit,
  editableFigureSvgSource,
  type FigureAnnotation,
  type FigureEdit,
  type FigureReference,
} from '@/src/document/figure-edit';
import { sanitizeSvgSource } from '@/src/security/svg-source';
import { resolveSafeImageUrl } from '@/src/security/resource-url';
import { DiagramEditorDialog } from './diagram-editor-dialog';

const emptySource = {
  referenceId: '',
  origin: 'original' as const,
  pdfPage: '',
  printedPage: '',
  figureNumber: '',
  note: '',
};
const wholeImage = { x: 0, y: 0, width: 100, height: 100 };
const emptyReference = { id: '', title: '', authors: '', year: '', url: '' };

export function FigureEditProperties({
  node,
  metadata,
  resolveImageUrl,
  disabled,
  onApply,
  onMetadataChange,
}: {
  node: FigureNode;
  metadata: DocumentMetadata;
  resolveImageUrl: (source: string) => string;
  disabled: boolean;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
  onMetadataChange: (metadata: Record<string, unknown>) => void;
}) {
  const current = readFigureEdit(node.attrs.figureEdit) ?? {
    version: 1 as const,
  };
  const [edit, setEdit] = useState<FigureEdit>(current);
  const [message, setMessage] = useState('');
  const [imageSize, setImageSize] = useState(current.imageSize);
  const [reference, setReference] = useState<FigureReference>(
    () =>
      figureReferences(metadata).find(
        (entry) => entry.id === current.source?.referenceId,
      ) ?? emptyReference,
  );
  const references = figureReferences(metadata);
  const source = edit.source ?? emptySource;
  useEffect(() => {
    const image = new Image();
    image.onload = () =>
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = resolveSafeImageUrl(node.attrs.src, resolveImageUrl) ?? '';
    return () => {
      image.onload = null;
    };
  }, [node.attrs.src, resolveImageUrl]);
  const svgElements = useMemo(() => {
    if (!edit.svgSource) return { labels: [] as string[], arrows: 0 };
    const parsed = new DOMParser().parseFromString(
      edit.svgSource,
      'image/svg+xml',
    );
    return {
      labels: Array.from(parsed.querySelectorAll('text')).map(
        (element) => element.textContent ?? '',
      ),
      arrows: parsed.querySelectorAll('[marker-end], [marker-start]').length,
    };
  }, [edit.svgSource]);
  const modifySvg = (modify: (document: Document) => void) => {
    if (!edit.svgSource) return;
    const parsed = new DOMParser().parseFromString(
      edit.svgSource,
      'image/svg+xml',
    );
    modify(parsed);
    setEdit({
      ...edit,
      svgSource: new XMLSerializer().serializeToString(parsed.documentElement),
    });
  };
  const apply = () => {
    try {
      let next = { ...edit, imageSize: imageSize ?? edit.imageSize };
      const attrs: Record<string, unknown> = {};
      let sanitized = false;
      const displaySvg = editableFigureSvgSource(edit);
      if (displaySvg) {
        const svg = sanitizeSvgSource(displaySvg);
        next = { ...next, imageSize: { width: svg.width, height: svg.height } };
        // Preserve attrs.src as the original image. The renderer uses a sanitized SVG copy.
        sanitized = svg.changed;
      }
      if (next.crop && !next.imageSize)
        throw new Error('原画像の読み込み後に切り抜きを適用してください。');
      const result = figureEditSchema.safeParse(next);
      if (!result.success)
        throw new Error(
          '切り抜き範囲と注釈の数値を確認してください。原画像に対する0〜100%で指定します。',
        );
      onApply(node.attrs.nodeId, { ...attrs, figureEdit: result.data });
      setMessage(
        sanitized
          ? '図を更新しました。SVG原本は保持し、表示用コピーから実行要素・外部参照・埋込画像・styleを除きました。'
          : '図の編集を適用しました。原画像・切り抜き・注釈・出典を個別に保持します。',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '図を適用できませんでした。',
      );
    }
  };
  const updateAnnotation = (
    index: number,
    changes: Partial<FigureAnnotation>,
  ) =>
    setEdit({
      ...edit,
      annotations: edit.annotations?.map((annotation, i) =>
        i === index ? { ...annotation, ...changes } : annotation,
      ),
    });
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded border p-3">
      <legend className="px-1 text-xs font-medium">図解・原図・出典</legend>
      <label
        className="property-field"
        htmlFor={`figure-name-${node.attrs.nodeId}`}
      >
        図の名前
        <Input
          id={`figure-name-${node.attrs.nodeId}`}
          value={edit.name ?? ''}
          onChange={(event) => setEdit({ ...edit, name: event.target.value })}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {edit.diagram
          ? '構造化図解です。矩形・楕円・文字・線を部品としてドラッグ編集できます。接続線は図形に追従します。'
          : edit.svgSource
            ? 'SVGソースを編集できる図です。ラベルと矢印は下の操作またはソースで変更できます。'
            : '画像として配置しています。画像内の文字は直接編集できません。SVG原本を指定するとソースを編集できます。'}
      </p>
      {edit.diagram && (
        <DiagramEditorDialog
          diagram={edit.diagram}
          disabled={disabled}
          onApply={(diagram) => {
            onApply(node.attrs.nodeId, {
              figureEdit: {
                ...edit,
                diagram,
                imageSize: { width: diagram.width, height: diagram.height },
              },
            });
          }}
        />
      )}
      {!edit.diagram && (
        <details className="space-y-2">
          <summary>SVGソース・ラベルを編集</summary>
          <label className="property-field">
            SVG原本を読み込む
            <input
              type="file"
              accept=".svg,image/svg+xml"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 1_000_000)
                    throw new Error('SVGソースは1 MB以内にしてください。');
                  const text = await file.text();
                  sanitizeSvgSource(text);
                  setEdit((value) => ({ ...value, svgSource: text }));
                  setMessage(
                    'SVG原本を読み込みました。図の編集を適用してください。',
                  );
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'SVGを開けませんでした。',
                  );
                }
                event.target.value = '';
              }}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setEdit({
                ...edit,
                svgSource: conceptDiagramSvg,
                source: {
                  ...source,
                  origin: 'concept',
                  note: '実測値ではない',
                },
              })
            }
          >
            3状態のSVG模式図に差し替え
          </Button>
          {svgElements.labels.map((label, index) => (
            <label className="property-field" key={index}>
              SVGラベル {index + 1}
              <Input
                value={label}
                onChange={(event) =>
                  modifySvg((document) => {
                    document.querySelectorAll('text')[index].textContent =
                      event.target.value;
                  })
                }
              />
            </label>
          ))}
          {Array.from({ length: svgElements.arrows }, (_, index) => (
            <Button
              key={index}
              size="sm"
              variant="outline"
              onClick={() =>
                modifySvg((document) => {
                  const arrow = document.querySelectorAll(
                    '[marker-end], [marker-start]',
                  )[index];
                  const start = arrow.getAttribute('marker-start');
                  const end = arrow.getAttribute('marker-end');
                  arrow.removeAttribute('marker-start');
                  arrow.removeAttribute('marker-end');
                  if (end) arrow.setAttribute('marker-start', end);
                  if (start) arrow.setAttribute('marker-end', start);
                  for (const marker of document.querySelectorAll('marker'))
                    marker.setAttribute('orient', 'auto-start-reverse');
                })
              }
            >
              矢印 {index + 1} の向きを反転
            </Button>
          ))}
          <label
            className="property-field"
            htmlFor={`figure-svg-${node.attrs.nodeId}`}
          >
            SVGソース
            <Textarea
              id={`figure-svg-${node.attrs.nodeId}`}
              className="font-mono text-xs"
              rows={8}
              value={edit.svgSource ?? ''}
              onChange={(event) =>
                setEdit({ ...edit, svgSource: event.target.value || undefined })
              }
            />
          </label>
          <p className="text-xs text-muted-foreground">
            ソース原本を保存します。表示用コピーでは実行要素・外部参照・埋込画像・styleを除きます。
          </p>
        </details>
      )}
      <details className="space-y-2">
        <summary>原画像の切り抜き・注釈</summary>
        <p className="text-xs text-muted-foreground">
          原画像の左上を0%、右下を100%として指定します。注釈は原画像に結び付き、切り抜き変更後も位置を保ちます。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <label className="property-field" key={key}>
              {
                {
                  x: '切り抜きX (%)',
                  y: '切り抜きY (%)',
                  width: '切り抜き幅 (%)',
                  height: '切り抜き高さ (%)',
                }[key]
              }
              <Input
                type="number"
                min={key === 'width' || key === 'height' ? 1 : 0}
                max={100}
                value={(edit.crop ?? wholeImage)[key]}
                onChange={(event) =>
                  setEdit({
                    ...edit,
                    crop: {
                      ...(edit.crop ?? wholeImage),
                      [key]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEdit({ ...edit, crop: undefined })}
        >
          切り抜きを解除
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={(edit.annotations?.length ?? 0) >= 100}
          onClick={() =>
            setEdit({
              ...edit,
              annotations: [
                ...(edit.annotations ?? []),
                {
                  id: createNodeId(),
                  kind: 'arrow',
                  x: 20,
                  y: 20,
                  x2: 60,
                  y2: 60,
                  text: '',
                  color: '#dc2626',
                  fontSize: 5,
                },
              ],
            })
          }
        >
          図の注釈を追加
        </Button>
        {edit.annotations?.map((annotation, index) => (
          <fieldset
            key={annotation.id}
            className="space-y-2 rounded border p-2"
          >
            <legend>注釈 {index + 1}</legend>
            <label className="property-field">
              注釈 {index + 1} の種類
              <select
                value={annotation.kind}
                onChange={(event) =>
                  updateAnnotation(index, {
                    kind: event.target.value as FigureAnnotation['kind'],
                  })
                }
              >
                {(['arrow', 'rectangle', 'text', 'number'] as const).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {
                        {
                          arrow: '矢印',
                          rectangle: '囲み',
                          text: '説明',
                          number: '番号',
                        }[kind]
                      }
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="property-field">
              注釈 {index + 1} の文字
              <Input
                value={annotation.text}
                onChange={(event) =>
                  updateAnnotation(index, { text: event.target.value })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'x2', 'y2'] as const).map((key) => (
                <label className="property-field" key={key}>
                  注釈 {index + 1} {key} (%)
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={annotation[key]}
                    onChange={(event) =>
                      updateAnnotation(index, {
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label className="property-field">
              注釈 {index + 1} 文字サイズ (%)
              <Input
                type="number"
                min={1}
                max={12}
                value={annotation.fontSize}
                onChange={(event) =>
                  updateAnnotation(index, {
                    fontSize: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="property-field">
              注釈 {index + 1} 色
              <Input
                type="color"
                value={annotation.color}
                onChange={(event) =>
                  updateAnnotation(index, { color: event.target.value })
                }
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEdit({
                  ...edit,
                  annotations: edit.annotations?.filter((_, i) => i !== index),
                })
              }
            >
              注釈 {index + 1} を削除
            </Button>
          </fieldset>
        ))}
      </details>
      <details className="space-y-2">
        <summary>図の由来・共有文献</summary>
        <label className="property-field">
          関連する文献
          <select
            value={source.referenceId}
            onChange={(event) => {
              const id = event.target.value;
              setEdit({ ...edit, source: { ...source, referenceId: id } });
              setReference(
                references.find((entry) => entry.id === id) ?? emptyReference,
              );
            }}
          >
            <option value="">文献なし / 新規文献</option>
            {references.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id} — {entry.title}
              </option>
            ))}
          </select>
        </label>
        <label className="property-field">
          図の由来
          <select
            value={source.origin}
            onChange={(event) =>
              setEdit({
                ...edit,
                source: {
                  ...source,
                  origin: event.target.value as typeof source.origin,
                },
              })
            }
          >
            {figureOrigins.map((origin) => (
              <option key={origin} value={origin}>
                {figureOriginLabels[origin]}
              </option>
            ))}
          </select>
        </label>
        {(['pdfPage', 'printedPage', 'figureNumber', 'note'] as const).map(
          (key) => (
            <label className="property-field" key={key}>
              {
                {
                  pdfPage: 'PDFページ',
                  printedPage: '論文内ページ',
                  figureNumber: '図表番号',
                  note: '由来の注記（例：実測値ではない）',
                }[key]
              }
              <Input
                value={source[key]}
                onChange={(event) =>
                  setEdit({
                    ...edit,
                    source: { ...source, [key]: event.target.value },
                  })
                }
              />
            </label>
          ),
        )}
        <fieldset className="space-y-2 border p-2">
          <legend>共有文献（同じIDの全図へ反映）</legend>
          {(['id', 'title', 'authors', 'year', 'url'] as const).map((key) => (
            <label className="property-field" key={key}>
              {
                {
                  id: '文献ID',
                  title: '文献の題名',
                  authors: '文献の著者',
                  year: '文献の年',
                  url: '文献のリンク',
                }[key]
              }
              <Input
                value={reference[key]}
                onChange={(event) =>
                  setReference({ ...reference, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const valid = figureReferenceSchema.safeParse(reference);
              if (!valid.success) {
                setMessage('文献IDとリンク（http/https）を確認してください。');
                return;
              }
              const exists = references.some(
                (entry) => entry.id === reference.id,
              );
              if (!exists && references.length >= 1000) {
                setMessage('文献は1000件以内にしてください。');
                return;
              }
              onMetadataChange({
                figure_references: exists
                  ? references.map((entry) =>
                      entry.id === reference.id ? reference : entry,
                    )
                  : [...references, reference],
              });
              setEdit({
                ...edit,
                source: { ...source, referenceId: reference.id },
              });
              setMessage(
                '共有文献を保存しました。この図へ関連付けるには図の編集を適用してください。',
              );
            }}
          >
            共有文献を保存
          </Button>
        </fieldset>
      </details>
      <Button size="sm" onClick={apply}>
        図の編集を適用
      </Button>
      {message && <output className="text-xs block">{message}</output>}
    </fieldset>
  );
}
