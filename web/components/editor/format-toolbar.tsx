'use client';

import type { ReactNode } from 'react';
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

export function FormatToolbar({
  editor,
  documentType,
}: {
  editor: Editor | null;
  documentType: DocumentType;
}) {
  const { copy } = useAppPreferences();
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
          editor
            ?.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Table2 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.insertChart}
        disabled={inNotes}
        onClick={() =>
          editor
            ?.chain()
            .focus()
            .insertContent({
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
            .run()
        }
      >
        <ChartNoAxesCombined />
      </FormatButton>
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
