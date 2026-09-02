export type DocumentType = 'report' | 'slide';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DocumentMetadata {
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  theme?: string;
  [key: string]: JsonValue | undefined;
}

export interface Mark {
  type: 'bold' | 'italic' | 'strike' | 'code' | 'link';
  attrs?: {
    href?: string;
    target?: string;
    rel?: string;
  };
}

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface InlineMathNode {
  type: 'inlineMath';
  attrs: {
    latex: string;
  };
}

export interface InlineImageNode {
  type: 'inlineImage';
  attrs: {
    nodeId: string;
    src: string;
    alt: string;
    title: string | null;
  };
}

export interface HardBreakNode {
  type: 'hardBreak';
}

export type InlineNode =
  | TextNode
  | InlineMathNode
  | InlineImageNode
  | HardBreakNode;

interface IdentifiedNode {
  attrs: {
    nodeId: string;
    [key: string]: unknown;
  };
}

export interface ParagraphNode extends IdentifiedNode {
  type: 'paragraph';
  content?: InlineNode[];
}

export interface HeadingNode extends IdentifiedNode {
  type: 'heading';
  attrs: IdentifiedNode['attrs'] & {
    level: 1 | 2 | 3 | 4 | 5 | 6;
  };
  content?: InlineNode[];
}

export interface BulletListNode extends IdentifiedNode {
  type: 'bulletList';
  content: ListItemNode[];
}

export interface OrderedListNode extends IdentifiedNode {
  type: 'orderedList';
  attrs: IdentifiedNode['attrs'] & {
    start: number;
  };
  content: ListItemNode[];
}

export interface ListItemNode extends IdentifiedNode {
  type: 'listItem';
  content: DocumentNode[];
}

export interface BlockquoteNode extends IdentifiedNode {
  type: 'blockquote';
  content: DocumentNode[];
}

export interface CodeBlockNode extends IdentifiedNode {
  type: 'codeBlock';
  attrs: IdentifiedNode['attrs'] & {
    language: string | null;
  };
  content?: TextNode[];
}

export interface FigureNode extends IdentifiedNode {
  type: 'figure';
  attrs: IdentifiedNode['attrs'] & {
    src: string;
    alt: string;
    title: string | null;
    width: number;
    align: 'left' | 'center' | 'right';
  };
}

export interface BlockMathNode extends IdentifiedNode {
  type: 'blockMath';
  attrs: IdentifiedNode['attrs'] & {
    latex: string;
  };
}

export interface HorizontalRuleNode extends IdentifiedNode {
  type: 'horizontalRule';
}

export interface TableNode extends IdentifiedNode {
  type: 'table';
  content: TableRowNode[];
}

export interface TableRowNode extends IdentifiedNode {
  type: 'tableRow';
  content: Array<TableHeaderNode | TableCellNode>;
}

export interface TableHeaderNode extends IdentifiedNode {
  type: 'tableHeader';
  attrs: IdentifiedNode['attrs'] & {
    align: 'left' | 'center' | 'right' | null;
  };
  content: ParagraphNode[];
}

export interface TableCellNode extends IdentifiedNode {
  type: 'tableCell';
  attrs: IdentifiedNode['attrs'] & {
    align: 'left' | 'center' | 'right' | null;
  };
  content: ParagraphNode[];
}

export type DocumentNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | ListItemNode
  | BlockquoteNode
  | CodeBlockNode
  | FigureNode
  | BlockMathNode
  | HorizontalRuleNode
  | TableNode
  | TableRowNode
  | TableHeaderNode
  | TableCellNode;

export interface DocumentData {
  schemaVersion: 1;
  type: DocumentType;
  metadata: DocumentMetadata;
  children: DocumentNode[];
}

export interface EditorDocument {
  type: 'doc';
  content: DocumentNode[];
}

export type IdFactory = () => string;

let fallbackId = 0;

export function createNodeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  fallbackId += 1;
  return `node-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

export function createDefaultDocument(
  type: DocumentType = 'report',
  idFactory: IdFactory = createNodeId,
): DocumentData {
  return {
    schemaVersion: 1,
    type,
    metadata: {
      title: type === 'report' ? '無題のレポート' : '無題のスライド',
      theme: type === 'report' ? 'latex' : 'beamer-simple',
    },
    children: [
      {
        type: 'heading',
        attrs: { nodeId: idFactory(), level: 1 },
        content: [{ type: 'text', text: 'タイトル' }],
      },
      {
        type: 'paragraph',
        attrs: { nodeId: idFactory() },
        content: [{ type: 'text', text: '本文を入力してください。' }],
      },
    ],
  };
}

export function toEditorDocument(document: DocumentData): EditorDocument {
  return {
    type: 'doc',
    content: document.children,
  };
}

export function withEditorDocument(
  document: DocumentData,
  editorDocument: EditorDocument,
): DocumentData {
  return {
    ...document,
    children: editorDocument.content,
  };
}

export function inlineText(content: InlineNode[] | undefined): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'text') return node.text;
      if (node.type === 'inlineMath') return node.attrs.latex;
      if (node.type === 'inlineImage') return node.attrs.alt;
      return '\n';
    })
    .join('');
}

export function documentTitle(document: DocumentData): string {
  if (typeof document.metadata.title === 'string' && document.metadata.title) {
    return document.metadata.title;
  }

  const heading = document.children.find(
    (node): node is HeadingNode =>
      node.type === 'heading' && node.attrs.level === 1,
  );
  return heading ? inlineText(heading.content) : '無題の文書';
}
