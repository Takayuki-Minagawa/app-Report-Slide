'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData, ParagraphNode } from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import {
  isFirstLineIndent,
  resolveParagraphIndent,
  type FirstLineIndent,
} from '@/src/document/paragraph-format';
import { isTextRuler } from '@/src/document/text-ruler';
import { selectedTextBlocks } from '@/src/editor/text-ruler-commands';
import {
  applyParagraphIndent,
  editorAfterHeadingIds,
  editorDocumentNodes,
} from '@/src/editor/paragraph-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function selectedCustomIndent(editor: Editor | null): string {
  const block = editor
    ? selectedTextBlocks(editor).find((entry) => entry.type === 'paragraph')
    : undefined;
  const indent: unknown = block
    ? editor!.state.doc.nodeAt(block.position)?.attrs.firstLineIndent
    : null;
  return isFirstLineIndent(indent) && indent.mode === 'em'
    ? String(indent.value)
    : '1';
}

export function ParagraphFormatControls({
  editor,
  document,
  disabled = false,
  chapterPrefix,
}: {
  editor: Editor | null;
  document: DocumentData;
  disabled?: boolean;
  chapterPrefix?: string;
}) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [revision, setRevision] = useState(0);
  const [custom, setCustom] = useState(() => selectedCustomIndent(editor));
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setRevision((value) => value + 1);
      setCustom(selectedCustomIndent(editor));
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);
  void revision;
  if (document.type !== 'report') return null;
  const blocks = editor
    ? selectedTextBlocks(editor).filter((block) => block.type === 'paragraph')
    : [];
  const paragraphs = blocks.map(
    (block) =>
      editor!.state.doc.nodeAt(block.position)!.toJSON() as ParagraphNode,
  );
  const settings = resolvePageSettings(document.metadata);
  const afterHeading = editor
    ? editorAfterHeadingIds(
        editorDocumentNodes(editor.state.doc),
        document,
        chapterPrefix,
      )
    : new Set<string>();
  const values = paragraphs.map((paragraph) => {
    const indent = paragraph.attrs.firstLineIndent;
    return isFirstLineIndent(indent)
      ? indent.mode === 'inherit'
        ? 'inherit'
        : String(indent.value)
      : isTextRuler(paragraph.attrs.textRuler)
        ? 'ruler'
        : 'inherit';
  });
  const mixed = new Set(values).size > 1;
  const selected = mixed ? 'mixed' : values[0];
  const resolved = paragraphs.map((paragraph) =>
    resolveParagraphIndent(paragraph, settings, {
      topLevel: true,
      afterHeading: afterHeading.has(paragraph.attrs.nodeId),
    }),
  );
  const signatures = new Set(
    resolved.map((value, index) => {
      const ruler = paragraphs[index].attrs.textRuler;
      const legacyPosition =
        value.source === 'ruler' && isTextRuler(ruler)
          ? `:${ruler.left},${ruler.right},${ruler.firstLine}`
          : '';
      return `${value.em}:${value.source}${legacyPosition}`;
    }),
  );
  const result = resolved[0];
  const valid = blocks.length > 0 && !disabled;
  const customValue = Number(custom);
  const customValid =
    custom.trim() !== '' &&
    Number.isFinite(customValue) &&
    customValue >= 0 &&
    customValue <= 8;
  const [width] = pageDimensions(settings);
  const textWidth = width - settings.margin_left - settings.margin_right;
  const overflow = paragraphs.some((paragraph, index) => {
    const ruler = paragraph.attrs.textRuler;
    const available =
      textWidth *
      (isTextRuler(ruler) ? (100 - ruler.left - ruler.right) / 100 : 1);
    return (
      resolved[index].em !== null &&
      (resolved[index].em! * settings.font_size * 25.4) / 72 >= available
    );
  });
  const apply = (indent: FirstLineIndent) => {
    if (editor && valid) applyParagraphIndent(editor, indent);
  };
  const source =
    result?.source === 'heading'
      ? ja
        ? '見出し直後の設定'
        : 'After-heading rule'
      : result?.source === 'explicit'
        ? ja
          ? 'この段落の指定'
          : 'Paragraph override'
        : ja
          ? '文書の設定'
          : 'Document setting';
  return (
    <fieldset
      className="space-y-2 rounded-md border p-2 text-xs"
      aria-label={ja ? '段落の字下げ' : 'Paragraph indentation'}
    >
      <legend className="px-1 font-semibold">
        {ja ? '段落の先頭行' : 'Paragraph first line'}
      </legend>
      <div className="flex flex-wrap gap-1">
        {(
          [
            [
              'inherit',
              ja ? '文書に従う' : 'Use document',
              { mode: 'inherit' },
            ],
            ['1', ja ? '1字下げる' : 'Indent 1 em', { mode: 'em', value: 1 }],
            ['0', ja ? '下げない' : 'No indent', { mode: 'em', value: 0 }],
          ] as const
        ).map(([key, label, value]) => (
          <Button
            key={key}
            type="button"
            size="xs"
            variant={selected === key ? 'secondary' : 'outline'}
            aria-pressed={selected === key}
            disabled={!valid}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <output className="block" aria-live="polite">
        {disabled
          ? ja
            ? 'Markdown原稿を適用または破棄してから変更してください。'
            : 'Apply or discard the Markdown draft first.'
          : !blocks.length
            ? ja
              ? '本文段落にカーソルを置いてください。見出し・表・箇条書き内は対象外です。'
              : 'Select a body paragraph. Headings, table cells and list items are excluded.'
            : mixed || signatures.size > 1
              ? ja
                ? `${blocks.length}段落：設定が混在しています。`
                : `${blocks.length} paragraphs: mixed settings.`
              : selected === 'ruler'
                ? ja
                  ? '詳細設定あり（文字位置ルーラー）'
                  : 'Custom text ruler setting'
                : `${ja ? '現在：' : 'Current: '}${result?.em === 0 ? (ja ? '下げない' : 'No indent') : `${result?.em}${ja ? '字下げる' : ' em'}`}（${source}）`}
      </output>
      {overflow && (
        <output className="block">
          {ja
            ? '字下げ幅が段落の幅を超えています。左右の位置または文字サイズを調整してください。'
            : 'The indent exceeds the paragraph width. Adjust the margins or font size.'}
        </output>
      )}
      <details>
        <summary>{ja ? '詳細：任意の字数' : 'Custom indent'}</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label>
            {ja ? '先頭行の字数' : 'First-line em'}
            <Input
              className="w-20"
              type="number"
              min={0}
              max={8}
              step={0.5}
              value={custom}
              disabled={!valid}
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!valid || !customValid}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply({ mode: 'em', value: customValue })}
          >
            {ja ? '字数を適用' : 'Apply indent'}
          </Button>
        </div>
        <p className="mt-1 text-muted-foreground">
          {ja
            ? '左右の位置やぶら下げは文字位置ルーラーで調整できます。先頭行の設定だけを変えても左右位置は保持します。'
            : 'Use the text ruler for side margins and hanging indents. First-line settings preserve side margins.'}
        </p>
      </details>
    </fieldset>
  );
}
