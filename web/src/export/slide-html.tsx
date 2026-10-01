/* oxlint-disable nextjs/no-head-element -- Standalone HTML output, not a Next.js route. */
import { renderToStaticMarkup } from 'react-dom/server.browser';
import katexLicense from 'katex/LICENSE?raw';
import documentStyles from '@/components/preview/document.css?raw';
import { DocumentPage } from '@/components/preview/document-page';
import { DocumentRenderer } from '@/components/preview/document-renderer';
import { documentTitle, type DocumentData } from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { WorkspaceStatusError, statusMessage } from '@/src/workspace/status';
import { embedSlideImages } from './embedded-images';
import { offlineMathStyles } from './math-styles';
import playerStyles from './slide-player.css?raw';
import playerSource from './slide-player.js?raw';
import { hashedInlineScript } from './standalone-html';

const playerMessages = {
  ja: {
    previous: '前へ',
    next: '次へ',
    overview: '一覧',
    notes: 'ノート',
    presenter: '発表者ビュー',
    fullscreen: '全画面',
    print: '印刷／PDF保存',
    navigation: 'スライド操作',
    counter: '表示中のスライド',
    progress: '発表の進捗',
    timer: '経過時間（クリックでリセット）',
    speakerNotes: '発表者ノート',
    noNotes: 'このスライドにノートはありません。',
    currentSlide: '現在のスライド',
    nextSlide: '次のスライド',
    lastSlide: '最後のスライドです。',
    elapsed: '経過時間',
    jump: '移動先のスライド番号（Enterで移動）:',
    help: '← → / Space: 移動 · 数字+Enter: 指定スライド · O: 一覧 · N: ノート · S: 発表者ビュー · B: 暗転 · F: 全画面 · P: 印刷',
    fullscreenUnavailable: 'このブラウザでは全画面表示を開始できません。',
    presenterUnavailable:
      '発表者ビューを開けません。このページのポップアップを許可してください。',
  },
  en: {
    previous: 'Previous',
    next: 'Next',
    overview: 'Overview',
    notes: 'Notes',
    presenter: 'Presenter view',
    fullscreen: 'Fullscreen',
    print: 'Print / Save PDF',
    navigation: 'Slide controls',
    counter: 'Current slide',
    progress: 'Presentation progress',
    timer: 'Elapsed time (click to reset)',
    speakerNotes: 'Speaker notes',
    noNotes: 'This slide has no notes.',
    currentSlide: 'Current slide',
    nextSlide: 'Next slide',
    lastSlide: 'This is the last slide.',
    elapsed: 'Elapsed time',
    jump: 'Go to slide number (press Enter):',
    help: '← → / Space: navigate · number+Enter: go to slide · O: overview · N: notes · S: presenter view · B: blackout · F: fullscreen · P: print',
    fullscreenUnavailable: 'Fullscreen is not available in this browser.',
    presenterUnavailable:
      'The presenter view could not be opened. Allow pop-ups for this page.',
  },
};

export interface SlideHtmlExport {
  html: string;
  externalImages: string[];
}

/** Render a snapshot, without changing the editable document or its save state. */
export async function exportSlideHtml(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<SlideHtmlExport> {
  const document = migrateDocumentData(source);
  if (document.type !== 'slide')
    throw new WorkspaceStatusError(statusMessage('htmlSlidesOnly'));
  const { resolveImageUrl, external } = await embedSlideImages(
    document,
    assets,
  );
  const analysis = analyzeDocument(document);
  const pages = splitDocumentPages(document);
  const copy = playerMessages[locale];
  const { script, policy } = await hashedInlineScript(playerSource);
  const styles =
    playerStyles + '\n' + documentStyles + '\n' + offlineMathStyles;

  const markup = renderToStaticMarkup(
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="Content-Security-Policy" content={policy} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>{documentTitle(document)}</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <header className="deck-heading">
          <h1 className="deck-title">{documentTitle(document)}</h1>
          <p className="deck-help">{copy.help}</p>
        </header>
        <main id="deck-viewport">
          <div id="deck-stage">
            {pages.map((nodes, index) => (
              <DocumentPage
                key={index}
                id={'slide-' + (index + 1)}
                className="deck-slide"
                document={document}
                nodes={nodes}
                analysis={analysis}
                locale={locale}
                index={index}
                count={pages.length}
                resolveImageUrl={resolveImageUrl}
              />
            ))}
          </div>
        </main>
        <section
          id="deck-notes"
          className="deck-notes"
          aria-label={copy.speakerNotes}
          hidden
        >
          <h2>{copy.speakerNotes}</h2>
          {pages.map((nodes, index) =>
            nodes.some((node) => node.type === 'speakerNotes') ? (
              <div key={index} className="deck-note">
                <DocumentRenderer
                  document={document}
                  nodes={nodes}
                  analysis={analysis}
                  locale={locale}
                  resolveImageUrl={resolveImageUrl}
                  speakerNotes
                />
              </div>
            ) : (
              <div key={index} className="deck-note" data-empty="">
                {copy.noNotes}
              </div>
            ),
          )}
        </section>
        <nav
          id="deck-controls"
          className="deck-controls"
          aria-label={copy.navigation}
          hidden
        >
          <button id="deck-previous" type="button">
            {copy.previous}
          </button>
          <output
            id="deck-counter"
            aria-label={copy.counter}
            aria-live="polite"
            aria-atomic="true"
          >
            1 / {pages.length}
          </output>
          <button id="deck-next" type="button">
            {copy.next}
          </button>
          <button id="deck-overview" type="button" aria-pressed="false">
            {copy.overview}
          </button>
          <button id="deck-notes-toggle" type="button" aria-pressed="false">
            {copy.notes}
          </button>
          <button
            id="deck-presenter"
            type="button"
            data-unavailable={copy.presenterUnavailable}
          >
            {copy.presenter}
          </button>
          <button
            id="deck-fullscreen"
            type="button"
            data-unavailable={copy.fullscreenUnavailable}
          >
            {copy.fullscreen}
          </button>
          <button id="deck-print" type="button">
            {copy.print}
          </button>
          <button id="deck-timer" type="button" title={copy.timer}>
            00:00
          </button>
        </nav>
        <progress
          id="deck-progress"
          aria-label={copy.progress}
          value={1}
          max={pages.length}
          hidden
        />
        <output id="deck-status" data-jump={copy.jump} />
        <template id="deck-presenter-template">
          <div className="presenter-slides">
            <section className="presenter-pane">
              <h2>{copy.currentSlide}</h2>
              <div id="presenter-current" className="presenter-frame" />
            </section>
            <section className="presenter-pane">
              <h2>{copy.nextSlide}</h2>
              <div
                id="presenter-next"
                className="presenter-frame"
                data-empty={copy.lastSlide}
              />
            </section>
          </div>
          <section className="presenter-pane presenter-pane-notes">
            <h2>{copy.speakerNotes}</h2>
            <div id="presenter-notes" className="presenter-notes" />
          </section>
          <footer className="presenter-status">
            <output id="presenter-counter" aria-label={copy.counter} />
            <output id="presenter-timer" aria-label={copy.elapsed}>
              00:00
            </output>
            <output id="presenter-status" />
          </footer>
        </template>
        <template id="katex-license">
          <pre>{katexLicense}</pre>
        </template>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>,
  );
  return { html: '<!doctype html>\n' + markup, externalImages: external };
}
