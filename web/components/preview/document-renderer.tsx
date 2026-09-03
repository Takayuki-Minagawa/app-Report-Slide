'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import katex from 'katex';

import { messages, type AppLocale } from '@/src/i18n/messages';
import { formatSemanticReference } from '@/src/i18n/diagnostics';
import type {
  DocumentData,
  DocumentNode,
  InlineNode,
  SlideImagePlacement,
  Mark,
  TableCellNode,
  TableHeaderNode,
} from '@/src/document/model';
import { tableCellBorderStyle } from '@/src/document/table';
import {
  safeResourceUrl,
  resolveSafeImageUrl as resolvedImageUrl,
  type ImageUrlResolver,
} from '@/src/security/resource-url';
import {
  analyzeDocument,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import {
  defaultSlideImagePlacement,
  isSlideImagePlacement,
  moveOrResizeSlideImage,
  type SlideImagePlacementAction,
} from '@/src/document/slide-layout';

export interface FigureInteraction {
  selectedNodeId?: string;
  onSelect?: (nodeId: string) => void;
  onPlacementChange?: (nodeId: string, placement: SlideImagePlacement) => void;
}

const AnalysisContext = createContext<DocumentAnalysis | null>(null);
const LocaleContext = createContext<AppLocale>('ja');
const SlideContext = createContext(false);
const FigureInteractionContext = createContext<FigureInteraction | undefined>(
  undefined,
);
const anchorId = (nodeId: string) => `kumi-${nodeId}`;

function useDocumentCopy() {
  const locale = useContext(LocaleContext);
  return { locale, copy: messages[locale] };
}

function Reference({ target }: { target: string }) {
  const { copy, locale } = useDocumentCopy();
  const resolved = useContext(AnalysisContext)?.labels.get(target);
  return resolved ? (
    <a
      className="preview-reference"
      href={`#${encodeURIComponent(anchorId(resolved.nodeId))}`}
    >
      {formatSemanticReference(resolved, locale)}
    </a>
  ) : (
    <span
      className="preview-reference-unresolved"
      title={copy.preview.unresolvedReference}
    >
      [@{target}]
    </span>
  );
}

function Caption({ node }: { node: DocumentNode }) {
  const { locale } = useDocumentCopy();
  const target = useContext(AnalysisContext)?.targets.get(node.attrs.nodeId);
  if (!target?.number && !node.attrs.caption) return null;
  return (
    <span>
      {target?.number
        ? `${formatSemanticReference(target, locale)}${node.attrs.caption ? ' — ' : ''}`
        : ''}
      {node.attrs.caption}
    </span>
  );
}

interface DocumentRendererProps {
  document: DocumentData;
  locale?: AppLocale;
  resolveImageUrl?: (source: string) => string;
  nodes?: DocumentNode[];
  analysis?: DocumentAnalysis;
  showToc?: boolean;
  figureInteraction?: FigureInteraction;
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
  const { copy } = useDocumentCopy();
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolvedImageUrl(src, resolveImageUrl);
  if (!resolvedSrc || failed) {
    return (
      <span className="preview-inline-image-fallback">
        {alt || copy.preview.imageUnavailable}
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
      case 'reference':
        return <Reference key={key} target={node.attrs.target} />;
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

const resizeActions: readonly SlideImagePlacementAction[] = [
  'north-west',
  'north-east',
  'south-west',
  'south-east',
  'north',
  'east',
  'south',
  'west',
];

function SlidePlacedFigure({
  node,
  resolveImageUrl,
  placement,
  interaction,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
  resolveImageUrl: ImageUrlResolver;
  placement: NonNullable<
    Extract<DocumentNode, { type: 'figure' }>['attrs']['slidePlacement']
  >;
  interaction?: FigureInteraction;
}) {
  const { copy } = useDocumentCopy();
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<SlideImagePlacement | null>(null);
  const currentPlacement = draft ?? placement;
  const activeCleanup = useRef<(() => void) | null>(null);
  const src = resolvedImageUrl(node.attrs.src, resolveImageUrl);
  const interactive = Boolean(interaction?.onPlacementChange);
  const selected = interaction?.selectedNodeId === node.attrs.nodeId;

  useEffect(
    () => () => {
      activeCleanup.current?.();
    },
    [],
  );

  const beginPointer = (
    event: PointerEvent<HTMLElement>,
    action: SlideImagePlacementAction,
  ) => {
    if (!interaction?.onPlacementChange) return;
    const canvas = event.currentTarget.closest<HTMLElement>(
      '[data-slide-layout-canvas]',
    );
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    interaction.onSelect?.(node.attrs.nodeId);
    activeCleanup.current?.();

    const initial = currentPlacement;
    const startX = event.clientX;
    const startY = event.clientY;
    let next = initial;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      next = moveOrResizeSlideImage(
        initial,
        ((moveEvent.clientX - startX) / bounds.width) * 100,
        ((moveEvent.clientY - startY) / bounds.height) * 100,
        action,
      );
      setDraft(next);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (activeCleanup.current === cleanup) activeCleanup.current = null;
    };
    const onEnd = () => {
      cleanup();
      interaction.onPlacementChange?.(node.attrs.nodeId, next);
      setDraft(null);
    };
    activeCleanup.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const adjustWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    action: SlideImagePlacementAction,
  ) => {
    if (!interaction?.onPlacementChange) return;
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, readonly [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const offset = delta[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = moveOrResizeSlideImage(
      currentPlacement,
      offset[0],
      offset[1],
      action,
    );
    interaction.onSelect?.(node.attrs.nodeId);
    interaction.onPlacementChange(node.attrs.nodeId, next);
  };

  return (
    <figure
      className="preview-figure slide-positioned-figure"
      data-selected={selected || undefined}
      data-align={node.attrs.align}
      style={{
        left: `${currentPlacement.x}%`,
        top: `${currentPlacement.y}%`,
        width: `${currentPlacement.width}%`,
        height: `${currentPlacement.height}%`,
      }}
    >
      {interactive && (
        <button
          type="button"
          className="slide-image-move-target"
          aria-label={node.attrs.alt || node.attrs.src}
          onClick={() => interaction?.onSelect?.(node.attrs.nodeId)}
          onPointerDown={(event) => beginPointer(event, 'move')}
          onKeyDown={(event) => adjustWithKeyboard(event, 'move')}
        />
      )}
      {src && !failed ? (
        <img
          src={src}
          alt={node.attrs.alt}
          title={node.attrs.title ?? undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="preview-image-fallback">
          <span>{copy.preview.imageUnavailable}</span>
          <small>{node.attrs.alt || node.attrs.src}</small>
        </div>
      )}
      <figcaption>
        <Caption node={node} />
      </figcaption>
      {interactive && selected && (
        <span className="slide-image-handles">
          {resizeActions.map((action) => (
            <button
              key={action}
              type="button"
              className={'slide-image-handle slide-image-handle-' + action}
              aria-label={copy.workspace.resizeImage}
              onClick={() => interaction.onSelect?.(node.attrs.nodeId)}
              onPointerDown={(event) => beginPointer(event, action)}
              onKeyDown={(event) => adjustWithKeyboard(event, action)}
            />
          ))}
        </span>
      )}
    </figure>
  );
}
function FigureBlock({
  node,
  resolveImageUrl,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
  resolveImageUrl: ImageUrlResolver;
}) {
  const { copy } = useDocumentCopy();
  const slide = useContext(SlideContext);
  const figureInteraction = useContext(FigureInteractionContext);
  const [failed, setFailed] = useState(false);
  const src = resolvedImageUrl(node.attrs.src, resolveImageUrl);
  const beginFreePlacement = () => {
    if (!slide || !figureInteraction?.onPlacementChange) return;
    figureInteraction.onSelect?.(node.attrs.nodeId);
    figureInteraction.onPlacementChange(node.attrs.nodeId, {
      ...defaultSlideImagePlacement,
    });
  };
  const beginFreePlacementWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    beginFreePlacement();
  };
  const layoutStarter =
    slide && figureInteraction?.onPlacementChange
      ? {
          tabIndex: 0,
          role: 'button' as const,
          'aria-label': node.attrs.alt || node.attrs.src,
          'aria-description': copy.workspace.slideLayoutHelp,
          onClick: beginFreePlacement,
          onKeyDown: beginFreePlacementWithKeyboard,
        }
      : undefined;
  const placement =
    slide && isSlideImagePlacement(node.attrs.slidePlacement)
      ? node.attrs.slidePlacement
      : undefined;
  if (placement)
    return (
      <SlidePlacedFigure
        node={node}
        resolveImageUrl={resolveImageUrl}
        placement={placement}
        interaction={figureInteraction}
      />
    );
  const width = Math.min(100, Math.max(10, Number(node.attrs.width) || 100));

  if (!src || failed) {
    return (
      <figure
        className={
          layoutStarter ? 'preview-figure slide-flow-figure' : 'preview-figure'
        }
        data-align={node.attrs.align}
        {...layoutStarter}
      >
        <div className="preview-image-fallback">
          <span>{copy.preview.imageUnavailable}</span>
          <small>{node.attrs.alt || node.attrs.src}</small>
        </div>
        <figcaption>
          <Caption node={node} />
        </figcaption>
      </figure>
    );
  }

  return (
    <figure
      className={
        layoutStarter ? 'preview-figure slide-flow-figure' : 'preview-figure'
      }
      data-align={node.attrs.align}
      style={{ width: `${width}%` }}
      {...layoutStarter}
    >
      <img
        src={src}
        alt={node.attrs.alt}
        title={node.attrs.title ?? undefined}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <figcaption>
        <Caption node={node} />
      </figcaption>
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
      {cell.content.map((paragraph) => (
        <p key={paragraph.attrs.nodeId}>
          {renderInline(paragraph.content, resolveImageUrl)}
        </p>
      ))}
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
  const target = useContext(AnalysisContext)?.targets.get(key);
  switch (node.type) {
    case 'heading': {
      const Tag = `h${node.attrs.level}` as
        | 'h1'
        | 'h2'
        | 'h3'
        | 'h4'
        | 'h5'
        | 'h6';
      return (
        <Tag id={anchorId(key)}>
          {target?.number && (
            <span className="section-number">{target.number} </span>
          )}
          {renderInline(node.content, resolveImageUrl)}
        </Tag>
      );
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
      return (
        <div id={anchorId(key)}>
          <FigureBlock node={node} resolveImageUrl={resolveImageUrl} />
        </div>
      );
    case 'blockMath':
      return (
        <div id={anchorId(key)} className="numbered-equation">
          <div className="equation-body">
            <MathContent display latex={node.attrs.latex} />
            {target?.number && (
              <span className="equation-number">({target.number})</span>
            )}
          </div>
          {node.attrs.caption && (
            <div className="equation-caption">{node.attrs.caption}</div>
          )}
        </div>
      );
    case 'pageBreak':
    case 'slideBreak':
      return null;
    case 'horizontalRule':
      return <hr />;
    case 'table':
      return (
        <div className="preview-table-wrap" id={anchorId(key)}>
          <table>
            {(target?.number || node.attrs.caption) && (
              <caption>
                <Caption node={node} />
              </caption>
            )}
            <tbody>
              {node.content.map((row) => (
                <tr key={row.attrs.nodeId}>
                  {(row.content ?? []).map((cell) => {
                    const Cell = cell.type === 'tableHeader' ? 'th' : 'td';
                    return (
                      <Cell
                        key={cell.attrs.nodeId}
                        colSpan={cell.attrs.colspan ?? 1}
                        rowSpan={cell.attrs.rowspan ?? 1}
                        style={{
                          textAlign: cell.attrs.align ?? undefined,
                          ...tableCellBorderStyle(cell.attrs.borders),
                        }}
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
  locale = 'ja',
  resolveImageUrl = (source) => source,
  nodes,
  analysis,
  showToc = true,
  figureInteraction,
}: DocumentRendererProps) {
  const copy = messages[locale];
  const computed = useMemo(
    () => analysis ?? analyzeDocument(document),
    [analysis, document],
  );
  return (
    <LocaleContext.Provider value={locale}>
      <AnalysisContext.Provider value={computed}>
        <SlideContext.Provider value={document.type === 'slide'}>
          <FigureInteractionContext.Provider value={figureInteraction}>
            <div className="document-renderer">
              {showToc &&
                document.metadata.toc === true &&
                computed.outline.length > 0 && (
                  <nav className="document-toc" aria-label={copy.preview.toc}>
                    <h2>{copy.preview.toc}</h2>
                    <ol>
                      {computed.outline.map((entry) => (
                        <li
                          key={entry.nodeId}
                          style={{
                            paddingLeft: `${((entry.level ?? 1) - 1) * 16}px`,
                          }}
                        >
                          <a
                            href={`#${encodeURIComponent(anchorId(entry.nodeId))}`}
                          >
                            {entry.number ? `${entry.number} ` : ''}
                            {entry.title}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </nav>
                )}
              {(nodes ?? document.children).map((node) => (
                <BlockNode
                  key={node.attrs.nodeId}
                  node={node}
                  resolveImageUrl={resolveImageUrl}
                />
              ))}
            </div>
          </FigureInteractionContext.Provider>
        </SlideContext.Provider>
      </AnalysisContext.Provider>
    </LocaleContext.Provider>
  );
}
