/* oxlint-disable typescript/no-implied-eval -- Exercise the exact trusted, bundled pagination runtime against a controlled Paged.js implementation. */
import { describe, expect, it, vi } from 'vitest';
import runtimeSource from './report-pagination-runtime.js?raw';
import type { ReportPaginationResult } from './pagination-ready';

interface RuntimeWindow {
  print: ReturnType<typeof vi.fn>;
  kumiPaginationReady?: Promise<ReportPaginationResult>;
}

interface LayoutOptions {
  transform?: (fragment: DocumentFragment) => void;
  renderResult?: { done: boolean; value: unknown };
}

function startPagination(body: string, options: LayoutOptions = {}) {
  const doc = document.implementation.createHTMLDocument('Report');
  doc.documentElement.lang = 'en';
  doc.documentElement.dataset.kumiPagination = 'pending';
  doc.body.innerHTML = `
    <style id="kumi-pagination-css"></style>
    <button id="print-report" disabled>Print</button>
    <span id="physical-page-count"></span>
    <output id="pagination-status">Laying out pages</output>
    <template id="kumi-pagination-source"><div class="report-sheet"><article class="report-layout" data-report-page-kind="body"><div class="document-renderer">${body}</div><footer>Source page number</footer></article></div></template>
    <main id="kumi-pagination-output"></main>`;
  Object.defineProperty(doc, 'fonts', {
    value: { load: vi.fn().mockResolvedValue([]), ready: Promise.resolve() },
  });
  const decode = vi.fn().mockResolvedValue(undefined);
  class DecodedImage {
    src = '';
    decode = decode;
  }
  const render = vi.fn(
    async () => options.renderResult ?? { done: true, value: undefined },
  );
  class Previewer {
    chunker = {
      render,
      hooks: {
        renderNode: { register: vi.fn() },
        onBreakToken: { register: vi.fn() },
        afterParsed: { register: vi.fn() },
        layout: { register: vi.fn() },
      },
    };
    on = vi.fn();

    async preview(
      source: DocumentFragment,
      _styles: unknown,
      output: HTMLElement,
    ) {
      // Paged.js preview() ignores an Error returned as the generator's value.
      // The runtime must reject it even if the emitted DOM otherwise looks valid.
      await this.chunker.render();
      const fragment = source.cloneNode(true) as DocumentFragment;
      options.transform?.(fragment);
      const page = doc.createElement('div');
      page.className = 'pagedjs_page';
      page.innerHTML =
        '<div class="pagedjs_pagebox"><div class="pagedjs_area"><div class="pagedjs_page_content"><div></div></div></div></div>';
      page.querySelector('.pagedjs_page_content > div')!.appendChild(fragment);
      output.appendChild(page);
      return { total: 1 };
    }
  }
  const runtimeWindow: RuntimeWindow = { print: vi.fn() };
  new Function('document', 'window', 'Paged', 'Image', runtimeSource)(
    doc,
    runtimeWindow,
    { Previewer },
    DecodedImage,
  );
  return {
    doc,
    ready: runtimeWindow.kumiPaginationReady!,
    print: doc.querySelector<HTMLButtonElement>('#print-report')!,
    output: doc.querySelector<HTMLElement>('#kumi-pagination-output')!,
    status: doc.querySelector<HTMLOutputElement>('#pagination-status')!,
    printWindow: runtimeWindow.print,
    render,
    decode,
  };
}

async function expectIncomplete(result: ReturnType<typeof startPagination>) {
  await expect(result.ready).rejects.toThrow(
    'Some content could not be laid out',
  );
  expect(result.doc.documentElement.dataset.kumiPagination).toBe('error');
  expect(result.status.getAttribute('role')).toBe('alert');
  expect(result.status.textContent).toContain(
    'Some content could not be laid out',
  );
  expect(result.output.hidden).toBe(true);
  expect(result.print.disabled).toBe(true);
  result.print.click();
  expect(result.printWindow).not.toHaveBeenCalled();
}

describe('physical report pagination integrity', () => {
  it('marks a complete report ready before enabling print and filling page references', async () => {
    const result = startPagination(
      '<nav class="document-toc"><a href="#heading">Introduction</a></nav><h1 id="heading" data-node-id="heading">Introduction</h1><p data-node-id="paragraph">The complete body.</p>',
    );
    expect(result.print.disabled).toBe(true);
    await expect(result.ready).resolves.toEqual({
      pageCount: 1,
      bodyPageCount: 1,
    });
    expect(result.doc.documentElement.dataset.kumiPagination).toBe('ready');
    expect(result.status.hidden).toBe(true);
    expect(result.output.hidden).toBe(false);
    expect(result.doc.querySelector('[data-toc-target]')?.textContent).toBe(
      '1',
    );
    expect(result.doc.querySelector('.kumi-physical-footer')?.textContent).toBe(
      '1',
    );
    expect(result.print.disabled).toBe(false);
    result.print.click();
    expect(result.printWindow).toHaveBeenCalledOnce();
  });

  it('rejects a resolved preview that silently drops a paragraph tail', async () => {
    const result = startPagination(
      '<p data-node-id="paragraph">The beginning. The missing ending.</p>',
      {
        transform: (fragment) => {
          fragment.querySelector('p')!.textContent = 'The beginning.';
        },
      },
    );
    await expectIncomplete(result);
    // The surviving paragraph ID must not make its incomplete text acceptable.
    expect(
      result.output.querySelector('[data-node-id="paragraph"]'),
    ).not.toBeNull();
  });

  it('rejects an engine error returned as a generator result even when output would be complete', async () => {
    const result = startPagination(
      '<p data-node-id="paragraph">Complete text.</p>',
      {
        renderResult: { done: true, value: new Error('Layout repeated') },
      },
    );
    await expectIncomplete(result);
    expect(result.render).toHaveBeenCalledOnce();
  });

  it('rejects a missing image node even when all visible text survives', async () => {
    const result = startPagination(
      '<p data-node-id="paragraph">Unchanged text.</p><figure data-node-id="image"><img src="data:image/png;base64,AA==" alt="Diagram"></figure>',
      {
        transform: (fragment) => fragment.querySelector('figure')!.remove(),
      },
    );
    await expectIncomplete(result);
    expect(result.decode).toHaveBeenCalledOnce();
    expect(result.output.querySelector('p')?.textContent).toBe(
      'Unchanged text.',
    );
  });

  it('ignores source footers, repeated table headers and hidden KaTeX MathML in text comparison', async () => {
    const result = startPagination(
      '<table data-node-id="table"><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table><span data-node-id="math" class="katex"><span class="katex-mathml">Hidden MathML</span><span class="katex-html">x = 1</span></span>',
      {
        transform: (fragment) => {
          const repeated = fragment
            .querySelector('thead')!
            .cloneNode(true) as HTMLElement;
          repeated.dataset.kumiRepeatedHeader = '';
          fragment.querySelector('table')!.appendChild(repeated);
          fragment.querySelector('.katex-mathml')!.textContent =
            'Different hidden representation';
          fragment.querySelector('footer')!.textContent =
            'Different source footer';
        },
      },
    );
    await expect(result.ready).resolves.toEqual({
      pageCount: 1,
      bodyPageCount: 1,
    });
    expect(result.print.disabled).toBe(false);
    expect(result.output.querySelectorAll('thead')).toHaveLength(2);
  });

  it('ignores only the hyphen inserted at a page edge while preserving authored nonbreaking hyphens', async () => {
    const result = startPagination(
      '<p data-node-id="paragraph">Authored\u2011hyphen international</p>',
      {
        transform: (fragment) => {
          fragment.querySelector('p')!.innerHTML =
            '<span class="pagedjs_hyphen">Authored\u2011hyphen inter\u2011</span><span>national</span>';
        },
      },
    );
    await expect(result.ready).resolves.toEqual({
      pageCount: 1,
      bodyPageCount: 1,
    });
    expect(result.print.disabled).toBe(false);
  });
});
