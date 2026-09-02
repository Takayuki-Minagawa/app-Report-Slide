'use client';

import { useMemo, useState, type ReactNode } from 'react';
import katex from 'katex';

import type {
  DocumentData,
  DocumentNode,
  InlineNode,
  Mark,
  TableCellNode,
  TableHeaderNode,
} from '@/src/document/model';
import { safeResourceUrl } from '@/src/security/resource-url';

interface DocumentRendererProps {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
}

type ImageUrlResolver = (source: string) => string;

function resolvedImageUrl(
  source: string,
  resolveImageUrl: ImageUrlResolver,
): string | undefined {
  const safeSource = safeResourceUrl(source, 'image');
  if (!safeSource) return undefined;
  const resolved = resolveImageUrl(safeSource);
  return resolved.startsWith('blob:')
    ? resolved
    : safeResourceUrl(resolved, 'image');
}

function MathContent({ display, latex }: { display: boolean; latex: string }) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: 'warn',
        output: 'htmlAndMathml',
      }),
    [display, latex],
  );

  const Tag = display ? 'div' : 'span';
  return (
    <Tag
      className={display ? 'preview-equation' : 'preview-inline-math'}
      data-latex={latex}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function applyMark(content: ReactNode, mark: Mark, key: string): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong key={key}>{content}</strong>;
    case 'italic':
      return <em key={key}>{content}</em>;
    case 'strike':
      return <s key={key}>{content}</s>;
    case 'code':
      return <code key={key}>{content}</code>;
    case 'link': {
      const href = mark.attrs?.href
        ? safeResourceUrl(mark.attrs.href, 'link')
        : undefined;
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {content}
        </a>
      ) : (
        <span key={key}>{content}</span>
      );
    }
  }
}

function InlineImageContent({
  alt,
  resolveImageUrl,
  src,
  title,
}: {
  alt: string;
  resolveImageUrl: ImageUrlResolver;
  src: string;
  title: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolvedImageUrl(src, resolveImageUrl);
  if (!resolvedSrc || failed) {
    return (
      <span className="preview-inline-image-fallback">
        {alt || '画像を表示できません'}
      </span>
    );
  }
  return (
    <img
      className="preview-inline-image"
      src={resolvedSrc}
      alt={alt}
      title={title ?? undefined}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function renderInline(
  nodes: InlineNode[] | undefined,
  resolveImageUrl: ImageUrlResolver,
): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case 'hardBreak':
        return <br key={key} />;
      case 'inlineMath':
        return (
          <MathContent key={key} display={false} latex={node.attrs.latex} />
        );
      case 'inlineImage':
        return (
          <InlineImageContent
            key={key}
            resolveImageUrl={resolveImageUrl}
            src={node.attrs.src}
            alt={node.attrs.alt}
            title={node.attrs.title}
          />
        );
      case 'text': {
        let content: ReactNode = node.text;
        for (const [markIndex, mark] of (node.marks ?? []).entries()) {
          content = applyMark(content, mark, `${key}-mark-${markIndex}`);
        }
        return <span key={key}>{content}</span>;
      }
    }
  });
}

function FigureBlock({
  node,
  resolveImageUrl,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
  resolveImageUrl: ImageUrlResolver;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolvedImageUrl(node.attrs.src, resolveImageUrl);
  const width = Math.min(100, Math.max(10, Number(node.attrs.width) || 100));

  if (!src || failed) {
    return (
      <figure className="preview-figure" data-align={node.attrs.align}>
        <div className="preview-image-fallback">
          <span>画像を表示できません</span>
          <small>{node.attrs.alt || node.attrs.src}</small>
        </div>
      </figure>
    );
  }

  return (
    <figure
      className="preview-figure"
      data-align={node.attrs.align}
      style={{ width: `${width}%` }}
    >
      <img
        src={src}
        alt={node.attrs.alt}
        title={node.attrs.title ?? undefined}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </figure>
  );
}

function TableCellContent({
  cell,
  resolveImageUrl,
}: {
  cell: TableCellNode | TableHeaderNode;
  resolveImageUrl: ImageUrlResolver;
}) {
  return (
    <>
      {cell.content.map((paragraph) =>
        renderInline(paragraph.content, resolveImageUrl),
      )}
    </>
  );
}

function BlockNode({
  node,
  resolveImageUrl,
}: {
  node: DocumentNode;
  resolveImageUrl: ImageUrlResolver;
}) {
  const key = node.attrs.nodeId;
  switch (node.type) {
    case 'heading': {
      const Tag = `h${node.attrs.level}` as
        | 'h1'
        | 'h2'
        | 'h3'
        | 'h4'
        | 'h5'
        | 'h6';
      return <Tag id={key}>{renderInline(node.content, resolveImageUrl)}</Tag>;
    }
    case 'paragraph':
      return <p>{renderInline(node.content, resolveImageUrl)}</p>;
    case 'bulletList':
      return (
        <ul>
          {node.content.map((item) => (
            <BlockNode
              key={item.attrs.nodeId}
              node={item}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </ul>
      );
    case 'orderedList':
      return (
        <ol start={node.attrs.start}>
          {node.content.map((item) => (
            <BlockNode
              key={item.attrs.nodeId}
              node={item}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </ol>
      );
    case 'listItem':
      return (
        <li>
          {node.content.map((child) => (
            <BlockNode
              key={child.attrs.nodeId}
              node={child}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </li>
      );
    case 'blockquote':
      return (
        <blockquote>
          {node.content.map((child) => (
            <BlockNode
              key={child.attrs.nodeId}
              node={child}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre data-language={node.attrs.language ?? undefined}>
          <code>{node.content?.map((text) => text.text).join('') ?? ''}</code>
        </pre>
      );
    case 'figure':
      return <FigureBlock node={node} resolveImageUrl={resolveImageUrl} />;
    case 'blockMath':
      return <MathContent display latex={node.attrs.latex} />;
    case 'horizontalRule':
      return <hr />;
    case 'table':
      return (
        <div className="preview-table-wrap">
          <table>
            <tbody>
              {node.content.map((row) => (
                <tr key={row.attrs.nodeId}>
                  {row.content.map((cell) => {
                    const Cell = cell.type === 'tableHeader' ? 'th' : 'td';
                    return (
                      <Cell
                        key={cell.attrs.nodeId}
                        style={{ textAlign: cell.attrs.align ?? undefined }}
                      >
                        <TableCellContent
                          cell={cell}
                          resolveImageUrl={resolveImageUrl}
                        />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      return null;
  }
}

export function DocumentRenderer({
  document,
  resolveImageUrl = (source) => source,
}: DocumentRendererProps) {
  return (
    <div className="document-renderer">
      {document.children.map((node) => (
        <BlockNode
          key={node.attrs.nodeId}
          node={node}
          resolveImageUrl={resolveImageUrl}
        />
      ))}
    </div>
  );
}
