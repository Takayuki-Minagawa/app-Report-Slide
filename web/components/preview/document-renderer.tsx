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
import { ReferenceSource } from './reference-source';
import { ChartGraphic } from './chart-graphic';
import { FigureGraphic, resolveFigureGraphicSource } from './figure-graphic';
import {
  figureReferences,
  figureSourceText,
  readFigureEdit,
  type FigureReference,
} from '@/src/document/figure-edit';
import {
  groupSlideDesignNodes,
  groupSlideCompositeNodes,
  createSlideComposite,
  type SlideDesign,
} from '@/src/document/slide-design';

import { messages, type AppLocale } from '@/src/i18n/messages';
import { formatSemanticReference } from '@/src/i18n/diagnostics';
import {
  isCalloutType,
  type DocumentData,
  type DocumentNode,
  type FootnoteNode,
  type InlineNode,
  type SlideImagePlacement,
  type Mark,
  type TableCellNode,
  type TableHeaderNode,
  type TableNode,
} from '@/src/document/model';
import { figureWithLabelStyle } from '@/src/document/role-style';
import { tableFillTextColor } from '@/src/document/table-fill';
import { readBlockLayout } from '@/src/document/block-layout';
import { tableCellBorderStyle } from '@/src/document/table';
import { textRulerStyle } from '@/src/document/text-ruler';
import {
  safeResourceUrl,
  resolveSafeImageUrl as resolvedImageUrl,
  type ImageUrlResolver,
} from '@/src/security/resource-url';
import {
  analyzeDocument,
  collectFootnotes,
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
const FigureReferencesContext = createContext<FigureReference[]>([]);
const SlideContext = createContext(false);
const RoleStylesContext = createContext<SlideDesign['roleStyles']>(undefined);
const FigureInteractionContext = createContext<FigureInteraction | undefined>(
  undefined,
);
/** Numbers of the footnotes that are listed in the audience output. */
const FootnoteContext = createContext<ReadonlyMap<FootnoteNode, number>>(
  new Map(),
);
const anchorId = (nodeId: string) => `kumi-${nodeId}`;
const footnoteId = (number: number) => `kumi-fn-${number}`;
const footnoteReferenceId = (number: number) => `kumi-fnref-${number}`;

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

function FootnoteReference({ node }: { node: FootnoteNode }) {
  const { copy } = useDocumentCopy();
  const number = useContext(FootnoteContext).get(node);
  // Unlisted footnotes (inside speaker notes) are shown in place.
  if (!number)
    return (
      <span className="footnote-inline">
        {copy.preview.footnoteInline(node.attrs.text)}
      </span>
    );
  return (
    <sup className="footnote-ref">
      <a
        id={footnoteReferenceId(number)}
        href={`#${footnoteId(number)}`}
        aria-label={copy.preview.footnoteReference(number)}
      >
        {number}
      </a>
    </sup>
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

function FigureSource({
  node,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
}) {
  const { locale } = useDocumentCopy();
  const references = useContext(FigureReferencesContext);
  const edit = readFigureEdit(node.attrs.figureEdit);
  const text = figureSourceText(edit, references);
  return (
    <ReferenceSource
      reference={references.find(
        (entry) => entry.id === edit?.source?.referenceId,
      )}
      sourceText={text}
      locale={locale}
    />
  );
}
function SharedSource({ referenceId }: { referenceId?: string | null }) {
  const { locale } = useDocumentCopy();
  const references = useContext(FigureReferencesContext);
  return (
    <ReferenceSource
      reference={references.find((entry) => entry.id === referenceId)}
      locale={locale}
      sourceText={
        referenceId && !references.some((entry) => entry.id === referenceId)
          ? referenceId
          : undefined
      }
    />
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
  /** Render only the presenter notes of these nodes instead of the audience content. */
  speakerNotes?: boolean;
  slideLayout?: SlideDesign['layout'];
  slideComposite?: SlideDesign['composite'];
  roleStyles?: SlideDesign['roleStyles'];
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
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const resolvedSrc = resolvedImageUrl(src, resolveImageUrl);
  if (!resolvedSrc || failedSrc === resolvedSrc) {
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
      onError={() => setFailedSrc(resolvedSrc)}
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
      case 'footnote':
        return <FootnoteReference key={key} node={node} />;
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

type ResizeAction = Exclude<SlideImagePlacementAction, 'move'>;

const resizeActions: readonly ResizeAction[] = [
  'north-west',
  'north-east',
  'south-west',
  'south-east',
  'north',
  'east',
  'south',
  'west',
];

const resizeDirections: Record<AppLocale, Record<ResizeAction, string>> = {
  ja: {
    'north-west': '左上の角',
    'north-east': '右上の角',
    'south-west': '左下の角',
    'south-east': '右下の角',
    north: '上辺',
    east: '右辺',
    south: '下辺',
    west: '左辺',
  },
  en: {
    'north-west': 'top-left corner',
    'north-east': 'top-right corner',
    'south-west': 'bottom-left corner',
    'south-east': 'bottom-right corner',
    north: 'top edge',
    east: 'right edge',
    south: 'bottom edge',
    west: 'left edge',
  },
};

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
  const { copy, locale } = useDocumentCopy();
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<SlideImagePlacement | null>(null);
  const currentPlacement = draft ?? placement;
  const activeCleanup = useRef<(() => void) | null>(null);
  const figureSource = resolveFigureGraphicSource(
    node,
    resolvedImageUrl(node.attrs.src, resolveImageUrl),
  );
  const src = figureSource.src;
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
    event.currentTarget.focus();
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
    event.currentTarget.focus();
  };

  return (
    <figure
      className="preview-figure slide-positioned-figure"
      data-node-id={node.attrs.nodeId}
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
          onClick={(event) => {
            interaction?.onSelect?.(node.attrs.nodeId);
            event.currentTarget.focus();
          }}
          onPointerDown={(event) => beginPointer(event, 'move')}
          onKeyDown={(event) => adjustWithKeyboard(event, 'move')}
        />
      )}
      {src && failedSrc !== src ? (
        <FigureGraphic
          node={node}
          src={src}
          resolvedSource={figureSource}
          placed
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="preview-image-fallback">
          <span>{copy.preview.imageUnavailable}</span>
          <small>{node.attrs.alt || node.attrs.src}</small>
        </div>
      )}
      <figcaption>
        <Caption node={node} />
        <FigureSource node={node} />
      </figcaption>
      {interactive && selected && (
        <span className="slide-image-handles">
          {resizeActions.map((action) => (
            <button
              key={action}
              type="button"
              className={'slide-image-handle slide-image-handle-' + action}
              aria-label={copy.workspace.resizeImage(
                resizeDirections[locale][action],
              )}
              onClick={(event) => {
                interaction?.onSelect?.(node.attrs.nodeId);
                event.currentTarget.focus();
              }}
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
  node: originalNode,
  resolveImageUrl,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
  resolveImageUrl: ImageUrlResolver;
}) {
  const { copy } = useDocumentCopy();
  const node = figureWithLabelStyle(
    originalNode,
    useContext(RoleStylesContext)?.figureLabel,
  );
  const slide = useContext(SlideContext);
  const interaction = useContext(FigureInteractionContext);
  const figureInteraction = readBlockLayout(node.attrs.blockLayout).locked
    ? { ...interaction, onPlacementChange: undefined }
    : interaction;
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const figureSource = resolveFigureGraphicSource(
    node,
    resolvedImageUrl(node.attrs.src, resolveImageUrl),
  );
  const src = figureSource.src;
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

  if (!src || failedSrc === src) {
    return (
      <figure
        data-node-id={node.attrs.nodeId}
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
          <FigureSource node={node} />
        </figcaption>
      </figure>
    );
  }

  return (
    <figure
      data-node-id={node.attrs.nodeId}
      className={
        layoutStarter ? 'preview-figure slide-flow-figure' : 'preview-figure'
      }
      data-align={node.attrs.align}
      style={{ width: `${width}%` }}
      {...layoutStarter}
    >
      <FigureGraphic
        node={node}
        src={src}
        resolvedSource={figureSource}
        onError={() => setFailedSrc(src)}
      />
      <figcaption>
        <Caption node={node} />
        <FigureSource node={node} />
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
        <p key={paragraph.attrs.nodeId} data-node-id={paragraph.attrs.nodeId}>
          {renderInline(paragraph.content, resolveImageUrl)}
        </p>
      ))}
    </>
  );
}

/** Match Tiptap's table view: column widths come from the first row. */
function tableColumnWidths(table: TableNode): Array<number | null> | null {
  const widths: Array<number | null> = [];

  for (const cell of table.content[0]?.content ?? []) {
    for (let offset = 0; offset < (cell.attrs.colspan ?? 1); offset += 1) {
      const width = cell.attrs.colwidth?.[offset];
      widths.push(
        typeof width === 'number' && Number.isFinite(width) && width > 0
          ? width
          : null,
      );
    }
  }

  return widths.some((width) => width !== null) ? widths : null;
}

function BlockNode({
  node,
  resolveImageUrl,
}: {
  node: DocumentNode;
  resolveImageUrl: ImageUrlResolver;
}) {
  const key = node.attrs.nodeId;
  const { copy } = useDocumentCopy();
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
        <Tag
          id={anchorId(key)}
          data-node-id={key}
          style={textRulerStyle(node.attrs.textRuler)}
        >
          {target?.number && (
            <span className="section-number">{target.number} </span>
          )}
          {renderInline(node.content, resolveImageUrl)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p
          data-node-id={key}
          data-block-role={readBlockLayout(node.attrs.blockLayout).role}
          style={textRulerStyle(node.attrs.textRuler)}
        >
          {renderInline(node.content, resolveImageUrl)}
        </p>
      );
    case 'bulletList':
      return (
        <ul data-node-id={key}>
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
        <ol data-node-id={key} start={node.attrs.start}>
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
        <li data-node-id={key}>
          {node.content.map((child) => (
            <BlockNode
              key={child.attrs.nodeId}
              node={child}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </li>
      );
    case 'blockquote': {
      const callout = isCalloutType(node.attrs.callout)
        ? node.attrs.callout
        : undefined;
      return (
        <blockquote data-node-id={key} data-callout={callout}>
          {callout && <p className="callout-title">{copy.callout[callout]}</p>}
          {node.content.map((child) => (
            <BlockNode
              key={child.attrs.nodeId}
              node={child}
              resolveImageUrl={resolveImageUrl}
            />
          ))}
        </blockquote>
      );
    }
    case 'codeBlock':
      return (
        <pre
          data-node-id={key}
          data-language={node.attrs.language ?? undefined}
        >
          <code>{node.content?.map((text) => text.text).join('') ?? ''}</code>
        </pre>
      );
    case 'figure':
      return (
        <div id={anchorId(key)}>
          <FigureBlock node={node} resolveImageUrl={resolveImageUrl} />
        </div>
      );
    case 'chart':
      return (
        <div id={anchorId(key)} data-node-id={key}>
          <ChartGraphic node={node} />
          <SharedSource referenceId={node.attrs.plot?.referenceId} />
        </div>
      );
    case 'blockMath':
      return (
        <div
          id={anchorId(key)}
          data-node-id={key}
          className="numbered-equation"
        >
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
    case 'speakerNotes':
      return null;
    case 'horizontalRule':
      return <hr data-node-id={key} />;
    case 'table': {
      const columnWidths = tableColumnWidths(node);
      const measuredWidth =
        columnWidths?.reduce<number>((sum, width) => sum + (width ?? 0), 0) ??
        0;
      const missingWidthCount =
        columnWidths?.filter((width) => width === null).length ?? 0;
      const tableWidthStyle = columnWidths
        ? missingWidthCount === 0
          ? { width: `${measuredWidth}px` }
          : { minWidth: `${measuredWidth + 80 * missingWidthCount}px` }
        : undefined;
      return (
        <div
          className="preview-table-wrap"
          id={anchorId(key)}
          data-node-id={key}
        >
          <table
            className={columnWidths ? 'preview-table-sized' : undefined}
            style={tableWidthStyle}
          >
            {(target?.number || node.attrs.caption) && (
              <caption>
                <Caption node={node} />
              </caption>
            )}
            {columnWidths && (
              <colgroup>
                {columnWidths.map((width, index) => (
                  <col key={index} style={width ? { width } : undefined} />
                ))}
              </colgroup>
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
                          backgroundColor: cell.attrs.fill ?? undefined,
                          color: tableFillTextColor(cell.attrs.fill),
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
          <SharedSource referenceId={node.attrs.sourceReferenceId} />
        </div>
      );
    }
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
  speakerNotes = false,
  slideLayout,
  slideComposite,
  roleStyles,
}: DocumentRendererProps) {
  const copy = messages[locale];
  const computed = useMemo(
    () => analysis ?? analyzeDocument(document),
    [analysis, document],
  );
  const footnoteNumbers = useMemo(
    () =>
      new Map(
        collectFootnotes(document.children).map(
          (footnote, index) => [footnote, index + 1] as const,
        ),
      ),
    [document.children],
  );
  const pageNodes = nodes ?? document.children;
  const blocks = speakerNotes
    ? pageNodes.flatMap((node) =>
        node.type === 'speakerNotes' ? node.content : [],
      )
    : pageNodes;
  const footnotes = speakerNotes ? [] : collectFootnotes(pageNodes);
  const composite =
    document.type === 'slide' && !speakerNotes && slideLayout === 'composite'
      ? (slideComposite ?? createSlideComposite(blocks))
      : undefined;
  const compositeGroups = composite
    ? groupSlideCompositeNodes(blocks, composite)
    : undefined;
  const layoutGroups =
    document.type === 'slide' && !speakerNotes && slideLayout
      ? groupSlideDesignNodes(
          blocks.filter((node) => node.type !== 'speakerNotes'),
          slideLayout,
        )
      : null;
  const renderBlocks = (content: DocumentNode[]) =>
    content.map((node) => (
      <BlockNode
        key={node.attrs.nodeId}
        node={node}
        resolveImageUrl={resolveImageUrl}
      />
    ));
  const renderRegion = (
    region: keyof NonNullable<typeof compositeGroups>['regions'],
  ) => {
    const content = compositeGroups?.regions[region];
    if (!content?.length) return null;
    const labels =
      locale === 'ja'
        ? {
            full: '全幅上部',
            left: composite?.reverseColumns ? '右側' : '左側',
            'right-top': composite?.reverseColumns ? '左上' : '右上',
            'right-bottom': composite?.reverseColumns ? '左下' : '右下',
            bottom: '全幅下部',
          }
        : {
            full: 'Full-width top',
            left: composite?.reverseColumns ? 'Right' : 'Left',
            'right-top': composite?.reverseColumns ? 'Top left' : 'Top right',
            'right-bottom': composite?.reverseColumns
              ? 'Bottom left'
              : 'Bottom right',
            bottom: 'Full-width bottom',
          };
    return (
      <section
        key={region}
        className={`slide-composite-region slide-composite-${region}`}
        data-composite-region={region}
        aria-label={labels[region]}
      >
        {renderBlocks(content)}
      </section>
    );
  };
  return (
    <FigureReferencesContext.Provider
      value={figureReferences(document.metadata)}
    >
      <LocaleContext.Provider value={locale}>
        <AnalysisContext.Provider value={computed}>
          <SlideContext.Provider value={document.type === 'slide'}>
            <RoleStylesContext.Provider value={roleStyles}>
              <FigureInteractionContext.Provider value={figureInteraction}>
                <FootnoteContext.Provider value={footnoteNumbers}>
                  <div className="document-renderer">
                    {showToc &&
                      !speakerNotes &&
                      document.metadata.toc === true &&
                      computed.outline.length > 0 && (
                        <nav
                          className="document-toc"
                          aria-label={copy.preview.toc}
                        >
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
                    {compositeGroups ? (
                      <>
                        {compositeGroups.title &&
                          renderBlocks([compositeGroups.title])}
                        {renderRegion('full')}
                        <div
                          className="slide-composite-grid"
                          data-reverse={composite?.reverseColumns || undefined}
                        >
                          {!composite?.reverseColumns && renderRegion('left')}
                          <div className="slide-composite-sidebar">
                            {renderRegion('right-top')}
                            {renderRegion('right-bottom')}
                          </div>
                          {composite?.reverseColumns && renderRegion('left')}
                        </div>
                        {renderRegion('bottom')}
                        {renderBlocks(compositeGroups.manual)}
                      </>
                    ) : layoutGroups ? (
                      <>
                        {layoutGroups.title &&
                          renderBlocks([layoutGroups.title])}
                        <div className="slide-design-columns">
                          {layoutGroups.columns.map((column, index) => (
                            <div key={index} className="slide-design-column">
                              {renderBlocks(column)}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      renderBlocks(blocks)
                    )}
                    {footnotes.length > 0 && (
                      <ol
                        className="document-footnotes"
                        aria-label={copy.preview.footnotes}
                      >
                        {footnotes.map((footnote) => {
                          const number = footnoteNumbers.get(footnote) ?? 0;
                          return (
                            <li
                              key={number}
                              id={footnoteId(number)}
                              value={number}
                            >
                              <span className="footnote-text">
                                {footnote.attrs.text}
                              </span>{' '}
                              <a
                                className="footnote-back"
                                href={`#${footnoteReferenceId(number)}`}
                                aria-label={copy.preview.footnoteBack(number)}
                              >
                                ↩
                              </a>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </FootnoteContext.Provider>
              </FigureInteractionContext.Provider>
            </RoleStylesContext.Provider>
          </SlideContext.Provider>
        </AnalysisContext.Provider>
      </LocaleContext.Provider>
    </FigureReferencesContext.Provider>
  );
}
