import { chromium } from 'playwright';

/** Inspect only an in-memory standalone export. Block all network requests. */
export async function inspectLayout(
  html,
  expectedPages,
  { physicalPagination = false } = {},
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const pagination = await page.evaluate(async (physicalPagination) => {
      const withTimeout = async (promise, milliseconds, message) => {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(message)),
                milliseconds,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      document.documentElement.style.setProperty('--deck-scale', '1');
      for (const slide of document.querySelectorAll('.deck-slide')) {
        slide.hidden = false;
        Object.assign(slide.style, {
          transform: 'none',
          width: '920px',
          height: '517.5px',
          position: 'relative',
        });
      }
      for (const image of document.images) image.loading = 'eager';
      await withTimeout(
        Promise.all([
          document.fonts.ready,
          ...Array.from(document.images, (image) => image.decode()),
          ...Array.from(
            document.querySelectorAll('svg image'),
            (image) =>
              new Promise((resolve, reject) => {
                const probe = new Image();
                probe.onload = resolve;
                probe.onerror = () =>
                  reject(new Error('SVG image failed to load'));
                probe.src =
                  image.getAttribute('href') ||
                  image.getAttribute('xlink:href') ||
                  '';
              }),
          ),
        ]),
        30_000,
        'Fonts or images did not finish loading within 30 seconds',
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (!physicalPagination) return null;
      if (typeof window.kumiPaginationReady?.then !== 'function')
        throw new Error('Missing native physical pagination completion signal');
      // Match the browser consumer: resources may take 30s, then layout 60s.
      const pagination = await withTimeout(
        window.kumiPaginationReady,
        100_000,
        'Physical pagination did not finish within 100 seconds',
      );
      const measuredPages = document.querySelectorAll('.pagedjs_page').length;
      if (
        document.documentElement.dataset.kumiPagination !== 'ready' ||
        !Number.isInteger(pagination?.pageCount) ||
        pagination.pageCount < 1 ||
        !Number.isInteger(pagination.bodyPageCount) ||
        pagination.bodyPageCount < 0 ||
        pagination.bodyPageCount > pagination.pageCount ||
        measuredPages !== pagination.pageCount
      )
        throw new Error(
          'Physical pagination did not produce its reported pages',
        );
      return {
        pageCount: pagination.pageCount,
        bodyPageCount: pagination.bodyPageCount,
      };
    }, physicalPagination);
    if (errors.length)
      throw new Error(`Exported HTML script failed: ${errors.join('; ')}`);
    const result = await page.evaluate(() => {
      if (typeof window.kumiInspectDocumentLayout !== 'function')
        throw new Error('Missing native layout inspector');
      return window.kumiInspectDocumentLayout();
    });
    const measuredPages = pagination?.pageCount ?? expectedPages;
    if (result.pages.length !== measuredPages || result.status === 'unmeasured')
      throw new Error(
        `Layout inspection did not measure every page (${result.pages.length}/${measuredPages}, ${result.status})`,
      );
    return {
      ...result,
      ...(pagination && { pagination }),
      browser: 'chromium',
      browserVersion: browser.version(),
      viewport: { width: 1440, height: 1000 },
    };
  } finally {
    await browser.close();
  }
}
