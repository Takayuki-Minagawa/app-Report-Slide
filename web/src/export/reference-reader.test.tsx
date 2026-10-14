/* oxlint-disable typescript/no-implied-eval -- Exercise the exact trusted, bundled offline-reader script against the test DOM. */
import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { DocumentRenderer } from '@/components/preview/document-renderer';
import { ReferenceSource } from '@/components/preview/reference-source';
import { ReaderDialog } from './reader-content';
import readerScript from './reader.js?raw';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { figureReferencesSchema } from '@/src/document/figure-edit';
import { resolveChartPlot } from '@/src/document/chart';
import { validateDocumentData } from '@/src/document/validation';
import type { ChartNode } from '@/src/document/model';

const reference = {
  id: 'paper',
  title: 'Study',
  authors: 'Author',
  year: '2026',
  url: 'https://example.org/study',
  pdfUrl: 'https://example.org/study.pdf#page=3',
  summary: 'Conditions: A < B\nA second line',
};
afterEach(() => {
  document.body.replaceChildren();
});
it('preserves table/chart reference links and summaries across Markdown and renders both as reader details', () => {
  const source = parseMarkdown(
    '| Method | Value |\n| --- | --- |\n| A | 42 |\n\n{source_reference="paper"}',
  ).document;
  const chart: ChartNode = {
    type: 'chart',
    attrs: {
      nodeId: 'chart',
      chartType: 'line',
      data: [{ label: 'A', x: 1, y: 2 }],
      series: 'Series',
      xLabel: 'X',
      yLabel: 'Y',
      width: 100,
      alt: 'Comparison',
    },
  };
  chart.attrs.plot = { ...resolveChartPlot(chart.attrs), referenceId: 'paper' };
  expect(
    source.children[0].attrs.sourceReferenceId,
    JSON.stringify(source),
  ).toBe('paper');
  source.children.push(chart);
  source.metadata.figure_references = [reference];
  const read = parseMarkdown(serializeDocument(validateDocumentData(source)));
  expect(
    read.diagnostics.filter((entry) => entry.severity === 'error'),
  ).toEqual([]);
  expect(read.document.metadata.figure_references).toEqual([reference]);
  expect(read.document.children[0].attrs.sourceReferenceId).toBe('paper');
  expect(read.document.children[1].attrs.plot).toMatchObject({
    referenceId: 'paper',
  });
  const output = new DOMParser().parseFromString(
    renderToStaticMarkup(<DocumentRenderer document={read.document} />),
    'text/html',
  );
  expect(output.querySelectorAll('[data-reader-reference]')).toHaveLength(2);
  expect(
    output.querySelectorAll('a[href="https://example.org/study.pdf#page=3"]'),
  ).toHaveLength(2);
  expect(
    output.querySelector('.figure-reference-content')?.textContent,
  ).toContain('Conditions: A < B');
  expect(
    figureReferencesSchema.safeParse([
      { ...reference, pdfUrl: 'javascript:alert(1)' },
    ]).success,
  ).toBe(false);
  expect(
    figureReferencesSchema.safeParse([
      { ...reference, summary: 'x'.repeat(10001) },
    ]).success,
  ).toBe(false);
});
it('opens reference details in the offline reader modal and restores focus without changing the page', () => {
  document.body.innerHTML = renderToStaticMarkup(
    <>
      <ReferenceSource reference={reference} />
      <ReaderDialog locale="ja" />
    </>,
  );
  const dialog = document.getElementById('reader-dialog') as HTMLDialogElement;
  const showModal = vi.fn(() => dialog.setAttribute('open', ''));
  dialog.showModal = showModal;
  dialog.close = vi.fn(() => {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  });
  new Function('document', readerScript)(document);
  const trigger = document.querySelector<HTMLElement>(
    '[data-reader-reference]',
  )!;
  const hash = location.hash;
  trigger.click();
  expect(showModal).toHaveBeenCalledOnce();
  expect(document.getElementById('reader-content')?.textContent).toContain(
    reference.summary,
  );
  expect(document.querySelector('details')?.open).toBe(false);
  document.getElementById('reader-close')!.click();
  expect(document.activeElement).toBe(trigger);
  expect(document.getElementById('reader-content')?.childNodes).toHaveLength(0);
  expect(location.hash).toBe(hash);
});
