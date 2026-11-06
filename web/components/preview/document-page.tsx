import {
  getSlidePageId,
  resolveSlideDesign,
  slideDesignStyle,
} from '@/src/document/slide-design';
import { resolveReportSettings } from '@/src/document/report-settings';
import {
  frontMatterPageCount,
  hasReportContentsPage,
  reportPageKind,
} from '@/src/document/report-pages';
import { reportPageStyle } from '@/src/document/page-settings';
import type { DocumentData, DocumentNode } from '@/src/document/model';
import { resolveDocumentTheme } from '@/src/document/metadata';
import type { DocumentAnalysis } from '@/src/document/semantics';
import { messages, type AppLocale } from '@/src/i18n/messages';
import type { ImageUrlResolver } from '@/src/security/resource-url';
import {
  DocumentContents,
  DocumentRenderer,
  type FigureInteraction,
} from './document-renderer';

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
  const kind = reportPageKind(document, index);
  const frontMatterCount = frontMatterPageCount(document);
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
      data-report-page-kind={!slide ? kind : undefined}
      data-slide-layout-canvas={figureInteraction ? '' : undefined}
    >
      {kind === 'cover' ? (
        <ReportCover document={document} locale={locale} />
      ) : kind === 'contents' ? (
        <div className="document-renderer report-contents-page">
          <DocumentContents
            document={document}
            analysis={analysis}
            locale={locale}
            showEmpty
          />
        </div>
      ) : (
        <DocumentRenderer
          document={document}
          locale={locale}
          nodes={nodes}
          analysis={analysis}
          showToc={
            slide
              ? index === 0
              : !hasReportContentsPage(document) && index === frontMatterCount
          }
          resolveImageUrl={resolveImageUrl}
          figureInteraction={figureInteraction}
          slideLayout={design?.layout}
          slideComposite={design?.composite}
          roleStyles={design?.roleStyles}
        />
      )}
      {kind === 'body' && (
        <footer>
          {slide && <span>{document.metadata.author ?? ''}</span>}
          {(!slide || document.metadata.slide_number !== false) && (
            <span>
              {index + 1 - frontMatterCount}
              {slide ? ` / ${count}` : ''}
            </span>
          )}
        </footer>
      )}
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

function ReportCover({
  document,
  locale,
}: {
  document: DocumentData;
  locale: AppLocale;
}) {
  const settings = resolveReportSettings(document.metadata);
  const clean = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const ja = locale === 'ja';
  const title =
    clean(document.metadata.title) || (ja ? '無題の報告書' : 'Untitled report');
  const subtitle = clean(document.metadata.subtitle);
  const fields = [
    [ja ? '所属' : 'Affiliation', settings.affiliation],
    [ja ? '著者' : 'Author', document.metadata.author],
    [ja ? '提出先' : 'Recipient', settings.recipient],
    [ja ? '日付' : 'Date', document.metadata.date],
    [ja ? '報告書番号' : 'Report number', settings.report_number],
  ]
    .map(([label, value]) => [label, clean(value)])
    .filter(([, value]) => value);
  return (
    <section className="report-cover" aria-label={ja ? '表紙' : 'Cover'}>
      <div className="report-cover-heading">
        <h1>{title}</h1>
        {subtitle && <p className="report-cover-subtitle">{subtitle}</p>}
      </div>
      {fields.length > 0 && (
        <dl className="report-cover-fields">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
