// Runs inside the standalone document, never in the editor's global DOM.
// Page numbers are read from the finished layout, not estimated from block offsets.
(() => {
  const ja = document.documentElement.lang === 'ja';
  const output = document.getElementById('kumi-pagination-output');
  const status = document.getElementById('pagination-status');
  const source = document.getElementById('kumi-pagination-source');
  const print = document.getElementById('print-report');
  const incomplete = () =>
    new Error(
      ja
        ? '本文の一部を組版できませんでした。長い段落や図表を分けて再試行してください。'
        : 'Some content could not be laid out. Split long paragraphs or tables and try again.',
    );
  const contentText = (root) => {
    const text = [];
    for (const section of root.querySelectorAll('.report-layout')) {
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (
          parent.closest('footer, [data-kumi-repeated-header], .katex-mathml')
        )
          continue;
        let value = node.textContent;
        // Paged.js appends a nonbreaking hyphen to a word split at a page edge.
        if (
          parent.classList.contains('pagedjs_hyphen') &&
          parent.lastChild === node &&
          value.endsWith('\u2011')
        )
          value = value.slice(0, -1);
        text.push(value);
      }
    }
    return text.join('');
  };
  const timeout = (promise, milliseconds) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Pagination timed out')),
          milliseconds,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };

  window.kumiPaginationReady = (async () => {
    const fragment = source.content.cloneNode(true);
    // Keep number width constant so resolving forward references cannot move pages.
    for (const link of fragment.querySelectorAll(
      '.document-toc a[href^="#"]',
    )) {
      const title = document.createElement('span');
      title.className = 'kumi-toc-title';
      title.append(...link.childNodes);
      const leader = document.createElement('span');
      leader.className = 'kumi-toc-leader';
      leader.setAttribute('aria-hidden', 'true');
      const number = document.createElement('span');
      number.className = 'kumi-toc-page';
      number.dataset.tocTarget = decodeURIComponent(
        link.getAttribute('href').slice(1),
      );
      number.textContent = '…';
      link.append(title, leader, number);
    }
    for (const image of fragment.querySelectorAll('img'))
      image.loading = 'eager';
    // Paged.js 0.4.3 mistakes an inline style without display (for example,
    // paragraph text-indent) for hidden content and carries heading keep-with-next
    // past it. Preserve the browser's real display value on the output clone.
    const measuring = document.createElement('div');
    measuring.style.cssText =
      'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    document.body.append(measuring);
    try {
      measuring.append(fragment);
      for (const element of measuring.querySelectorAll('[style]')) {
        if (element.style && !element.style.display)
          element.style.display = getComputedStyle(element).display;
      }
    } finally {
      fragment.append(...measuring.childNodes);
      measuring.remove();
    }
    let expectedText = contentText(fragment);
    const expectedNodes = new Set(
      [...fragment.querySelectorAll('[data-node-id]')].map(
        (node) => node.dataset.nodeId,
      ),
    );
    // Eagerly decode embedded images before determining their page positions.
    await timeout(
      Promise.all([
        document.fonts.load('10pt "Noto Serif JP"'),
        document.fonts.load('10pt "Noto Sans JP"'),
        ...[...fragment.querySelectorAll('img, svg image')].map(
          async (element) => {
            const image = new Image();
            image.src =
              element.getAttribute('src') ||
              element.getAttribute('href') ||
              element.getAttribute('xlink:href');
            await image.decode();
          },
        ),
      ]),
      30000,
    );
    await document.fonts.ready;
    // Complete header groups are repeated when a table crosses a physical page.
    for (const body of fragment.querySelectorAll('table > tbody')) {
      const rows = [];
      for (const row of body.rows) {
        if (
          !row.cells.length ||
          [...row.cells].some((cell) => cell.tagName !== 'TH')
        )
          break;
        rows.push(row);
      }
      if (
        !rows.length ||
        rows.some((row, index) =>
          [...row.cells].some((cell) => index + cell.rowSpan > rows.length),
        )
      )
        continue;
      const head = document.createElement('thead');
      body.before(head);
      rows.forEach((row) => head.append(row));
    }
    const style = document.getElementById('kumi-pagination-css');
    const previewer = new Paged.Previewer();
    const renderedTextSources = new WeakMap();
    previewer.chunker.hooks.renderNode.register((rendered, original) => {
      if (
        rendered.nodeType !== Node.TEXT_NODE ||
        original.nodeType !== Node.TEXT_NODE
      )
        return;
      const sourceText = original.textContent;
      const remainingText = rendered.textContent;
      if (sourceText.endsWith(remainingText)) {
        renderedTextSources.set(rendered, {
          node: original,
          consumed: sourceText.length - remainingText.length,
        });
      }
    });
    previewer.chunker.hooks.onBreakToken.register((token, overflow) => {
      if (!token || !overflow) return;
      const original = renderedTextSources.get(overflow.startContainer);
      if (!original) return;
      // Paged.js uses indexOf(remainingText), which jumps backwards for repeated
      // text. The rendered clone is the actual suffix, so retain its exact offset.
      token.node = original.node;
      token.offset = original.consumed + overflow.startOffset;
    });
    const tableHeaders = new Map();
    previewer.chunker.hooks.afterParsed.register((content) => {
      // Use the source after HTML whitespace normalization, before any page
      // splitting. Multiple collapsible spaces may legitimately become one.
      expectedText = contentText(content);
      for (const table of content.querySelectorAll('table')) {
        if (table.tHead) tableHeaders.set(table.dataset.ref, table.tHead);
      }
    });
    // Paged.js rebuilds a continued table's ancestors without preceding thead
    // siblings. Restore the header before overflow measurement, so its height
    // participates in the row break instead of being added to a full page later.
    previewer.chunker.hooks.layout.register((wrapper) => {
      for (const table of wrapper.querySelectorAll('table[data-split-from]')) {
        if (table.tHead) continue;
        const sourceHeader = tableHeaders.get(table.dataset.ref);
        if (!sourceHeader) continue;
        const header = sourceHeader.cloneNode(true);
        for (const element of header.querySelectorAll('[id]'))
          element.removeAttribute('id');
        header.removeAttribute('id');
        header.dataset.kumiRepeatedHeader = '';
        table.insertBefore(header, table.tBodies[0] ?? table.firstChild);
      }
    });
    let generatedPages = 0;
    const render = previewer.chunker.render.bind(previewer.chunker);
    previewer.chunker.render = async (...args) => {
      const result = await render(...args);
      // Paged.js 0.4.3 returns OverflowContentError as a generator result on
      // repeated breaks. Its preview() otherwise resolves a truncated report.
      if (result?.value instanceof Error) throw incomplete();
      return result;
    };
    previewer.on('page', () => {
      // Bound pathological overflow instead of emitting guessed page references.
      if (++generatedPages > 2000) throw new Error('Report exceeds 2000 pages');
    });
    await timeout(
      previewer.preview(
        fragment,
        [{ 'https://kumi.invalid/report.css': style.textContent }],
        output,
      ),
      60000,
    );
    const pages = [...output.querySelectorAll('.pagedjs_page')];
    if (!pages.length) throw new Error('No pages were generated');
    // A preview promise resolving does not prove every source node was emitted.
    // Compare before filling contents numbers or adding physical footers.
    const actualNodes = new Set(
      [...output.querySelectorAll('[data-node-id]')].map(
        (node) => node.dataset.nodeId,
      ),
    );
    if (
      contentText(output) !== expectedText ||
      [...expectedNodes].some((id) => !actualNodes.has(id))
    )
      throw incomplete();
    const targets = new Map();
    let bodyPage = 0;
    for (const [index, page] of pages.entries()) {
      page.dataset.physicalPage = String(index + 1);
      const body = page.querySelector('[data-report-page-kind="body"]');
      page.dataset.reportPageKind = body
        ? 'body'
        : page.querySelector('[data-report-page-kind="cover"]')
          ? 'cover'
          : 'contents';
      if (!body) continue;
      const renderer = body.querySelector('.document-renderer');
      if (
        renderer &&
        !renderer.textContent.trim() &&
        [...renderer.querySelectorAll('*')].every((element) =>
          ['P', 'BR'].includes(element.tagName),
        )
      ) {
        // An empty final source page can leave Paged.js's full-height column
        // wrapper fragmented into phantom columns. It has no authored content;
        // let only this empty wrapper shrink while keeping the physical sheet.
        page.querySelector('.pagedjs_page_content > div').style.height = 'auto';
      }
      bodyPage++;
      page.dataset.bodyPage = String(bodyPage);
      for (const element of page.querySelectorAll('[id]')) {
        if (!targets.has(element.id)) targets.set(element.id, bodyPage);
      }
      const footer = document.createElement('div');
      footer.className = 'kumi-physical-footer';
      footer.textContent = String(bodyPage);
      page.querySelector('.pagedjs_pagebox').append(footer);
    }
    for (const number of output.querySelectorAll('[data-toc-target]')) {
      const page = targets.get(number.dataset.tocTarget);
      if (!page)
        throw new Error(
          'Contents target was not laid out: ' + number.dataset.tocTarget,
        );
      number.textContent = String(page);
      number.setAttribute('aria-label', ja ? `${page}ページ` : `Page ${page}`);
    }
    source.remove();
    const inspect = () => {
      const results = pages.map((page, index) => {
        const bounds = page.getBoundingClientRect();
        const area = page.querySelector('.pagedjs_area');
        const limit = area.getBoundingClientRect();
        const issues = [];
        // Paged's internal column wrapper can span unused columns on the final
        // page. Measure the authored layout and every descendant, not that wrapper.
        for (const element of area.querySelectorAll(
          '.report-layout, .report-layout *',
        )) {
          if (
            !(element instanceof HTMLElement) ||
            element.closest('.katex-mathml')
          )
            continue;
          const style = getComputedStyle(element);
          if (style.visibility === 'hidden' || style.display === 'none')
            continue;
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          if (
            box.left < limit.left - 2 ||
            box.right > limit.right + 2 ||
            box.bottom > limit.bottom + 2
          ) {
            issues.push({
              code: 'page-height',
              element: element.tagName.toLowerCase(),
              reason: 'Content exceeds the physical text area.',
            });
            break;
          }
          if (
            /(auto|scroll|hidden|clip)/.test(style.overflowX) &&
            element.scrollWidth > element.clientWidth + 2
          ) {
            issues.push({
              code: 'clipped-content',
              element: element.tagName.toLowerCase(),
              reason: 'Content is clipped.',
            });
            break;
          }
        }
        return {
          page: index + 1,
          type: 'report',
          status: issues.length ? 'overflow' : 'pass',
          widthPx: bounds.width,
          heightPx: bounds.height,
          limitWidthPx: bounds.width,
          limitHeightPx: bounds.height,
          issues,
        };
      });
      return {
        schemaVersion: 1,
        status: results.some((page) => page.issues.length)
          ? 'overflow'
          : 'pass',
        tolerancePx: 2,
        pages: results,
      };
    };
    window.kumiInspectDocumentLayout = inspect;
    const inspection = inspect();
    if (inspection.status !== 'pass')
      throw new Error(
        ja
          ? '用紙に収まらない図表や内容があります。大きさや改行を調整してください。'
          : 'Some content does not fit the paper. Adjust sizes or line breaks.',
      );
    document.documentElement.dataset.kumiPagination = 'ready';
    document.getElementById('physical-page-count').textContent = ja
      ? `${pages.length}ページ（本文${bodyPage}ページ）`
      : `${pages.length} pages (${bodyPage} body pages)`;
    status.hidden = true;
    print.disabled = false;
    print.addEventListener('click', () => window.print());
    return { pageCount: pages.length, bodyPageCount: bodyPage };
  })();
  // Keep the rejected promise available to callers while displaying a usable error.
  window.kumiPaginationReady.catch((error) => {
    document.documentElement.dataset.kumiPagination = 'error';
    status.textContent =
      (ja
        ? 'ページ番号を計算できませんでした。'
        : 'Could not calculate page numbers. ') + error.message;
    status.setAttribute('role', 'alert');
    output.hidden = true;
  });
})();
