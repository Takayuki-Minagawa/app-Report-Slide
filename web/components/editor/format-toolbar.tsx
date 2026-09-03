'use client';

import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  FunctionSquare,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Sigma,
  Table2,
} from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { DocumentType } from '@/src/document/model';
import { insertDocumentBreak } from '@/src/editor/document-commands';

export function FormatToolbar({
  editor,
  documentType,
}: {
  editor: Editor | null;
  documentType: DocumentType;
}) {
  const { copy } = useAppPreferences();
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
        active={editor?.isActive('heading', { level: 1 })}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <Heading1 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.heading2}
        active={editor?.isActive('heading', { level: 2 })}
        onClick={() =>
          editor?.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 />
      </FormatButton>
      <FormatButton
        label={copy.workspace.bulletList}
        active={editor?.isActive('bulletList')}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </FormatButton>
      <FormatButton
        label={copy.workspace.orderedList}
        active={editor?.isActive('orderedList')}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </FormatButton>
      <FormatButton
        label={copy.workspace.quote}
        active={editor?.isActive('blockquote')}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </FormatButton>
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
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      size="icon-sm"
      variant={active ? 'secondary' : 'ghost'}
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  );
}
