import { chromium } from 'playwright';

/** Inspect only an in-memory standalone export. Block all network requests. */
export async function inspectLayout(html, expectedPages) {
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
    await page.evaluate(async () => {
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
      await Promise.race([
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
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Fonts or images did not finish loading within 30 seconds',
                ),
              ),
            30_000,
          ),
        ),
      ]);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    if (errors.length)
      throw new Error(`Exported HTML script failed: ${errors.join('; ')}`);
    const result = await page.evaluate(() => {
      if (typeof window.kumiInspectDocumentLayout !== 'function')
        throw new Error('Missing native layout inspector');
      return window.kumiInspectDocumentLayout();
    });
    if (result.pages.length !== expectedPages || result.status === 'unmeasured')
      throw new Error(
        `Layout inspection did not measure every page (${result.pages.length}/${expectedPages}, ${result.status})`,
      );
    return {
      ...result,
      browser: 'chromium',
      browserVersion: browser.version(),
      viewport: { width: 1440, height: 1000 },
    };
  } finally {
    await browser.close();
  }
}
