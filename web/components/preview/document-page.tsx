import {
  getSlidePageId,
  resolveSlideDesign,
  slideDesignStyle,
} from '@/src/document/slide-design';
import { reportPageStyle } from '@/src/document/page-settings';
import type { DocumentData, DocumentNode } from '@/src/document/model';
import { resolveDocumentTheme } from '@/src/document/metadata';
import type { DocumentAnalysis } from '@/src/document/semantics';
import { messages, type AppLocale } from '@/src/i18n/messages';
import type { ImageUrlResolver } from '@/src/security/resource-url';
import { DocumentRenderer, type FigureInteraction } from './document-renderer';

interface DocumentPageProps {
  document: DocumentData;
  nodes: DocumentNode[];
  analysis: DocumentAnalysis;
  locale: AppLocale;
  index: number;
  count: number;
  resolveImageUrl?: ImageUrlResolver;
  figureInteraction?: FigureInteraction;
  id?: string;
  className?: string;
}

/** Shared by the live preview and standalone HTML export. */
export function DocumentPage({
  document,
  nodes,
  analysis,
  locale,
  index,
  count,
  resolveImageUrl,
  figureInteraction,
  id,
  className = '',
}: DocumentPageProps) {
  const slide = document.type === 'slide';
  const copy = messages[locale];
  const design = slide ? resolveSlideDesign(document, index) : undefined;
  const page = (
    <article
      id={id}
      className={`${slide ? 'slide-preview' : 'report-preview report-layout'} ${className}`.trim()}
      data-theme={
        design?.theme ??
        resolveDocumentTheme(document.type, document.metadata.theme)
      }
      data-slide-design={design ? '1' : undefined}
      data-layout={design?.layout}
      data-density={design?.density}
      data-role-styles={
        Object.keys(design?.roleStyles ?? {}).join(' ') || undefined
      }
      data-table-striped={design?.tableStyle?.striped}
      data-page-id={slide ? getSlidePageId(document, index) : undefined}
      style={design ? slideDesignStyle(design) : undefined}
      aria-label={
        slide ? copy.preview.slidePreview : copy.preview.reportPreview
      }
      data-page={index + 1}
      data-slide-layout-canvas={figureInteraction ? '' : undefined}
    >
      <DocumentRenderer
        document={document}
        locale={locale}
        nodes={nodes}
        analysis={analysis}
        showToc={index === 0}
        resolveImageUrl={resolveImageUrl}
        figureInteraction={figureInteraction}
        slideLayout={design?.layout}
        slideComposite={design?.composite}
        roleStyles={design?.roleStyles}
      />
      <footer>
        {slide && <span>{document.metadata.author ?? ''}</span>}
        {(!slide || document.metadata.slide_number !== false) && (
          <span>
            {index + 1}
            {slide ? ` / ${count}` : ''}
          </span>
        )}
      </footer>
    </article>
  );
  return slide ? (
    page
  ) : (
    <div className="report-sheet" style={reportPageStyle(document.metadata)}>
      {page}
    </div>
  );
}
