/* oxlint-disable nextjs/no-head-element -- Standalone HTML output, not a Next.js route. */
import { renderToStaticMarkup } from 'react-dom/server.browser';
import katexLicense from 'katex/LICENSE?raw';
import documentStyles from '@/components/preview/document.css?raw';
import { DocumentPage } from '@/components/preview/document-page';
import { documentTitle, type DocumentData } from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { WorkspaceStatusError, statusMessage } from '@/src/workspace/status';
import { bytesToBase64, embedSlideImages } from './embedded-images';
import { offlineMathStyles } from './math-styles';
import playerStyles from './slide-player.css?raw';
import playerSource from './slide-player.js?raw';

const playerMessages = {
  ja: {
    previous: '前へ',
    next: '次へ',
    fullscreen: '全画面',
    navigation: 'スライド操作',
    counter: '表示中のスライド',
    help: '← → / Space で移動 · F で全画面',
    fullscreenUnavailable: 'このブラウザでは全画面表示を開始できません。',
  },
  en: {
    previous: 'Previous',
    next: 'Next',
    fullscreen: 'Fullscreen',
    navigation: 'Slide controls',
    counter: 'Current slide',
    help: '← → / Space to navigate · F for fullscreen',
    fullscreenUnavailable: 'Fullscreen is not available in this browser.',
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
  // HTML parsing normalizes line endings; hash exactly the bytes the browser sees.
  const script = playerSource.replace(/\r\n?/g, '\n');
  const hash = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)),
    ),
  );
  const policy =
    "default-src 'none'; img-src data: https: http:; font-src data:; style-src 'unsafe-inline'; script-src 'sha256-" +
    hash +
    "'; base-uri 'none'; form-action 'none'";
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
          <button
            id="deck-fullscreen"
            type="button"
            data-unavailable={copy.fullscreenUnavailable}
          >
            {copy.fullscreen}
          </button>
        </nav>
        <output id="deck-status" />
        <template id="katex-license">
          <pre>{katexLicense}</pre>
        </template>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>,
  );
  return { html: '<!doctype html>\n' + markup, externalImages: external };
}
