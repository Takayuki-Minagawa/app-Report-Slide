// Shared by the standalone Report warning and the local batch export inspector.
// This is a self-contained browser script, embedded under the HTML export CSP.
(() => {
  const tolerancePx = 2;
  const clips = (value) => /^(?:auto|scroll|hidden|clip)$/.test(value);
  const rounded = (value) => Math.round(value * 1000) / 1000;
  const describe = (element) => {
    const nodeId = element.closest('[data-node-id]')?.dataset.nodeId;
    return {
      element: element.tagName.toLowerCase(),
      ...(nodeId ? { nodeId } : {}),
    };
  };

  window.kumiInspectDocumentLayout = () => {
    const pages = [
      ...document.querySelectorAll('.report-sheet, .slide-preview[data-page]'),
    ].map((page, index) => {
      const report = page.classList.contains('report-sheet');
      const article = report ? page.querySelector('.report-layout') : page;
      const box = page.getBoundingClientRect();
      const style = getComputedStyle(page);
      const heightLimit = Number.parseFloat(
        report ? style.minHeight : style.height,
      );
      const issues = [];
      const result = {
        page: index + 1,
        type: report ? 'report' : 'slide',
        status: 'pass',
        widthPx: rounded(box.width),
        heightPx: rounded(box.height),
        limitWidthPx: box.width > 0 ? rounded(box.width) : null,
        limitHeightPx:
          Number.isFinite(heightLimit) && heightLimit > 0
            ? rounded(heightLimit)
            : null,
        issues,
      };
      // Comparing transformed DOMRects with untransformed scroll/client sizes
      // is invalid. The batch runner shows all slides at their native size.
      if (
        !article ||
        box.width <= 0 ||
        box.height <= 0 ||
        page.offsetWidth <= 0 ||
        !result.limitHeightPx ||
        Math.abs(box.width - page.offsetWidth) > tolerancePx ||
        Math.abs(box.height - page.offsetHeight) > tolerancePx
      ) {
        result.status = 'unmeasured';
        issues.push({
          code: 'unmeasured',
          ...describe(page),
          reason:
            'Page is hidden, transformed, or has no measurable page size.',
        });
        return result;
      }
      const fonts = document.fonts;
      const failedFont =
        fonts &&
        typeof fonts[Symbol.iterator] === 'function' &&
        [...fonts].some((font) => font.status === 'error');
      if (fonts?.status === 'loading' || failedFont) {
        issues.push({
          code: 'unmeasured',
          ...describe(page),
          reason: failedFont
            ? 'A web font could not be loaded.'
            : 'Fonts have not finished loading.',
        });
      }
      for (const image of page.querySelectorAll('img')) {
        if (!image.complete || image.naturalWidth === 0) {
          issues.push({
            code: 'unmeasured',
            ...describe(image),
            reason: 'Image is not loaded or could not be decoded.',
          });
        }
      }
      if (box.height > heightLimit + tolerancePx) {
        issues.push({
          code: 'page-height',
          ...describe(page),
          measuredPx: rounded(box.height),
          limitPx: rounded(heightLimit),
        });
      }
      // Scroll extents include right/bottom overflow, but not content placed
      // outside the left/top edge. Also inspect HTML element bounds below.
      if (page.scrollWidth > page.clientWidth + tolerancePx) {
        issues.push({
          code: 'page-width',
          ...describe(page),
          measuredPx: page.scrollWidth,
          limitPx: page.clientWidth,
        });
      }
      for (const element of [page, ...page.querySelectorAll('*')]) {
        if (!(element instanceof HTMLElement)) continue;
        // KaTeX deliberately clips a parallel accessibility representation.
        // SVG drawing internals also have their own intentional clipping.
        if (element.closest('.katex-mathml')) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.width === 0 && bounds.height === 0) continue;
        const elementStyle = getComputedStyle(element);
        if (elementStyle.visibility === 'hidden') continue;
        const overflowX = elementStyle.overflowX || elementStyle.overflow;
        const overflowY = elementStyle.overflowY || elementStyle.overflow;
        if (
          element.clientWidth > 0 &&
          clips(overflowX) &&
          element.scrollWidth > element.clientWidth + tolerancePx
        ) {
          issues.push({
            code: 'clipped-x',
            ...describe(element),
            measuredPx: element.scrollWidth,
            limitPx: element.clientWidth,
          });
        }
        if (
          element.clientHeight > 0 &&
          clips(overflowY) &&
          element.scrollHeight > element.clientHeight + tolerancePx
        ) {
          issues.push({
            code: 'clipped-y',
            ...describe(element),
            measuredPx: element.scrollHeight,
            limitPx: element.clientHeight,
          });
        }
        if (
          bounds.left < box.left - tolerancePx ||
          bounds.right > box.right + tolerancePx
        ) {
          issues.push({
            code: 'page-width',
            ...describe(element),
            measuredPx: rounded(
              Math.max(box.right, bounds.right) -
                Math.min(box.left, bounds.left),
            ),
            limitPx: rounded(box.width),
          });
        }
        if (
          bounds.top < box.top - tolerancePx ||
          bounds.bottom > box.top + heightLimit + tolerancePx
        ) {
          issues.push({
            code: 'page-height',
            ...describe(element),
            measuredPx: rounded(
              Math.max(box.top + heightLimit, bounds.bottom) -
                Math.min(box.top, bounds.top),
            ),
            limitPx: rounded(heightLimit),
          });
        }
      }
      result.status = issues.some((issue) => issue.code === 'unmeasured')
        ? 'unmeasured'
        : issues.length
          ? 'overflow'
          : 'pass';
      return result;
    });
    return {
      schemaVersion: 1,
      status:
        !pages.length || pages.some((page) => page.status === 'unmeasured')
          ? 'unmeasured'
          : pages.some((page) => page.status === 'overflow')
            ? 'overflow'
            : 'pass',
      tolerancePx,
      pages,
    };
  };
})();
