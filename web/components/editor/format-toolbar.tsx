'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  ChartNoAxesCombined,
  FunctionSquare,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  NotebookPen,
  Quote,
  Sigma,
  Superscript,
  Table2,
} from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  calloutTypes,
  createNodeId,
  isCalloutType,
  type DocumentType,
} from '@/src/document/model';
import {
  insertDocumentBreak,
  insertFootnote,
  insertSpeakerNotes,
  selectionTouchesSpeakerNotes,
  setCallout,
} from '@/src/editor/document-commands';
import {
  insertDocumentBlock,
  insertionPage,
  type BlockInsertionTarget,
} from '@/src/editor/block-commands';
import { createConceptFigure } from '@/src/document/figure-edit';
import { createStructuredDiagramFigure } from '@/src/document/diagram';
import { imageFileAccept } from '@/src/workspace/files';

export function FormatToolbar({
  editor,
  documentType,
  onOpenPdf,
  onInsertImage,
}: {
  editor: Editor | null;
  documentType: DocumentType;
  onOpenPdf?: (target: BlockInsertionTarget) => void;
  onInsertImage?: (
    file: File,
    target: BlockInsertionTarget,
  ) => { ok: boolean; message: string };
}) {
  const { copy, locale } = useAppPreferences();
  const [insertionTarget, setInsertionTarget] =
    useState<BlockInsertionTarget>('after-block');
  const [insertionResult, setInsertionResult] = useState('');
  const [imageError, setImageError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const ja = locale === 'ja';
  const insert = (value: Parameters<typeof insertDocumentBlock>[1]) => {
    if (!editor) return;
    const page = insertionPage(editor, insertionTarget);
    if (insertDocumentBlock(editor, value, insertionTarget))
      setInsertionResult(
        ja ? `${page}ページに挿入しました` : `Inserted on page ${page}`,
      );
  };
  // Notes hold paragraphs only: a block command would lift the text out of
  // them and into the slide.
  const inNotes = Boolean(editor && selectionTouchesSpeakerNotes(editor));
  const activeCallout: unknown = editor?.isActive('blockquote')
    ? editor.getAttributes('blockquote').callout
    : undefined;
  return (
    <div
      className="format-toolbar"
      role="toolbar"
      aria-label={copy.workspace.format}
    >
      {onInsertImage && (
        <>
          <input
            ref={imageInput}
            type="file"
            accept={imageFileAccept}
            aria-label={ja ? '挿入する画像ファイル' : 'Image file to insert'}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const result = onInsertImage(file, insertionTarget);
              setImageError(result.ok ? '' : result.message);
              setInsertionResult(result.ok ? result.message : '');
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!editor || inNotes}
            onClick={() => imageInput.current?.click()}
            title={
              ja
                ? 'PNG・JPEG・WebP・GIF・SVGを現在の挿入先に追加（1件20 MB以内）'
                : 'Insert PNG, JPEG, WebP, GIF or SVG at the selected target (20 MB per image)'
            }
          >
            {copy.workspace.insertImage}
          </Button>
          {imageError && (
            <p role="alert" className="text-xs text-destructive">
              {imageError}
            </p>
          )}
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!editor || inNotes}
        onClick={() => insert(createStructuredDiagramFigure())}
      >
        {ja ? '図形で図解を作る' : 'Create a shape diagram'}
      </Button>
      {onOpenPdf && (
        <Button
          variant="outline"
          size="sm"
          disabled={!editor || inNotes}
          onClick={() => onOpenPdf(insertionTarget)}
        >
          {ja ? 'PDFから図を追加' : 'Add figure from PDF'}
        </Button>
      )}
      <FormatButton
        label={copy.workspace.bold}
        active={editor?.isActive('bold')}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </FormatButton>
      <FormatButton
        label={copy.workspace.italic}
        active={editor?.isActive('italic')}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </FormatButton>
      <Separator orientation="vertical" className="mx-1 h-5 self-center" />
      <FormatButton
        label={copy.workspace.heading1}
        disabled={inNotes}
        active={editor?.isActive('heading', { level: 1 })}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <Heading1 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.heading2}
        disabled={inNotes}
        active={editor?.isActive('heading', { level: 2 })}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.bulletList}
        disabled={inNotes}
        active={editor?.isActive('bulletList')}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </FormatButton>
      <FormatButton
        label={copy.workspace.orderedList}
        disabled={inNotes}
        active={editor?.isActive('orderedList')}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </FormatButton>
      <FormatButton
        label={copy.workspace.quote}
        disabled={inNotes}
        active={editor?.isActive('blockquote')}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </FormatButton>
      <NativeSelect
        aria-label={copy.workspace.calloutType}
        title={copy.workspace.calloutType}
        size="sm"
        disabled={inNotes}
        value={isCalloutType(activeCallout) ? activeCallout : ''}
        onChange={(event) =>
          editor &&
          setCallout(
            editor,
            isCalloutType(event.target.value) ? event.target.value : null,
          )
        }
      >
        <NativeSelectOption value="">
          {copy.workspace.calloutNone}
        </NativeSelectOption>
        {calloutTypes.map((type) => (
          <NativeSelectOption key={type} value={type}>
            {copy.callout[type]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Separator orientation="vertical" className="mx-1 h-5 self-center" />
      <FormatButton
        label={copy.workspace.inlineMath}
        onClick={() =>
          editor?.chain().focus().insertInlineMath({ latex: 'x = y + 1' }).run()
        }
      >
        <Sigma />
      </FormatButton>
      <FormatButton
        label={copy.workspace.blockMath}
        disabled={inNotes}
        onClick={() =>
          editor
            ?.chain()
            .focus()
            .insertBlockMath({
              latex: 'M\\ddot{x}+C\\dot{x}+Kx=F(t)',
            })
            .run()
        }
      >
        <FunctionSquare />
      </FormatButton>
      <FormatButton
        label={copy.workspace.insertTable}
        disabled={inNotes}
        onClick={() =>
          insert({
            type: 'table',
            content: Array.from({ length: 3 }, (_, row) => ({
              type: 'tableRow',
              content: Array.from({ length: 3 }, () => ({
                type: row === 0 ? 'tableHeader' : 'tableCell',
                content: [{ type: 'paragraph' }],
              })),
            })),
          })
        }
      >
        <Table2 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.insertChart}
        disabled={inNotes}
        onClick={() =>
          insert({
            type: 'chart',
            attrs: {
              nodeId: createNodeId(),
              chartType: 'line',
              data: [
                { label: 'A', x: 1, y: 2 },
                { label: 'B', x: 2, y: 4 },
              ],
              xLabel: 'X',
              yLabel: 'Y',
              series: 'Series 1',
              alt: 'Chart',
              width: 100,
              caption: null,
            },
          })
        }
      >
        <ChartNoAxesCombined />
      </FormatButton>
      <Button
        size="sm"
        variant="ghost"
        disabled={inNotes}
        onClick={() => insert(createConceptFigure())}
      >
        {ja ? 'SVG図解を挿入' : 'Insert SVG diagram'}
      </Button>
      <NativeSelect
        aria-label={ja ? '図表の挿入先' : 'Figure and table insertion target'}
        size="sm"
        value={insertionTarget}
        onChange={(event) =>
          setInsertionTarget(event.target.value as BlockInsertionTarget)
        }
      >
        <NativeSelectOption value="after-block">
          {ja ? '選択ブロックの後' : 'After selected block'}
        </NativeSelectOption>
        <NativeSelectOption value="page-end">
          {ja ? '現在のページ末尾' : 'End of current page'}
        </NativeSelectOption>
        <NativeSelectOption value="cursor">
          {ja
            ? 'カーソル位置（セル内を含む）'
            : 'Cursor (including table cells)'}
        </NativeSelectOption>
      </NativeSelect>
      <output
        className="text-[10px] text-muted-foreground"
        aria-live="polite"
        aria-label={ja ? '図表の挿入結果' : 'Insertion result'}
      >
        {insertionResult ||
          (editor
            ? ja
              ? `挿入先: ${insertionPage(editor, insertionTarget)}ページ`
              : `Target: page ${insertionPage(editor, insertionTarget)}`
            : '')}
      </output>
      <FormatButton
        label={copy.workspace.insertFootnote}
        onClick={() =>
          editor && insertFootnote(editor, copy.workspace.footnoteDefault)
        }
      >
        <Superscript />
      </FormatButton>
      {documentType === 'slide' && (
        <FormatButton
          label={copy.workspace.insertSpeakerNotes}
          onClick={() => editor && insertSpeakerNotes(editor)}
        >
          <NotebookPen />
        </FormatButton>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          editor &&
          insertDocumentBreak(
            editor,
            documentType === 'slide' ? 'slideBreak' : 'pageBreak',
          )
        }
      >
        {documentType === 'slide'
          ? copy.workspace.insertSlideBreak
          : copy.workspace.insertPageBreak}
      </Button>
    </div>
  );
}

function FormatButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      size="icon-sm"
      variant={active ? 'secondary' : 'ghost'}
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  );
}
