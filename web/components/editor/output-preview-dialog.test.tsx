import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportPrintHtml } from '@/src/export/print-html';
import { exportReportHtml } from '@/src/export/report-html';
import type { ReportPaginationResult } from '@/src/export/pagination-ready';
import { OutputPreviewDialog } from './output-preview-dialog';

vi.mock('@/src/export/print-html', () => ({ exportPrintHtml: vi.fn() }));
vi.mock('@/src/export/report-html', () => ({ exportReportHtml: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(exportPrintHtml).mockResolvedValue({
    html: '<html data-kumi-pagination="pending"></html>',
    pageCount: 1,
    paginated: true,
    rasterElements: [],
    externalImages: [],
  });
  vi.mocked(exportReportHtml).mockResolvedValue({
    html: '<html></html>',
    externalImages: [],
  });
});

async function preview(ready: Promise<ReportPaginationResult>) {
  const source = parseMarkdown('# Report').document;
  source.metadata.report_settings = { toc_page_numbers: true };
  render(
    <AppPreferencesProvider>
      <OutputPreviewDialog
        snapshot={{ document: source, assets: new Map() }}
        onClose={vi.fn()}
      />
    </AppPreferencesProvider>,
  );
  const iframe = await screen.findByTitle<HTMLIFrameElement>('出力プレビュー');
  const frame = iframe.contentDocument!;
  // Simulate the initial blank load before the actual srcdoc document exists.
  await act(async () => {
    fireEvent.load(iframe);
    await Promise.resolve();
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '印刷／PDF保存' })).toBeDisabled();
  frame.body.innerHTML = '<div class="pagedjs_page"></div>'.repeat(4);
  Object.defineProperty(frame, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  frame.documentElement.dataset.kumiPagination = 'pending';
  Object.assign(frame.defaultView!, {
    kumiPaginationReady: ready.then((result) => {
      frame.documentElement.dataset.kumiPagination = 'ready';
      return result;
    }),
  });
  fireEvent.load(iframe);
  return iframe;
}

describe('paginated output preview', () => {
  it('keeps printing disabled until pagination finishes and then shows the physical page count', async () => {
    let complete!: (result: ReportPaginationResult) => void;
    const iframe = await preview(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const print = screen.getByRole('button', { name: '印刷／PDF保存' });
    expect(print).toBeDisabled();
    expect(screen.queryByText('1 原稿ページ')).not.toBeInTheDocument();
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts');
    await act(async () => complete({ pageCount: 4, bodyPageCount: 2 }));
    await waitFor(() => expect(print).toBeEnabled());
    expect(screen.getByText('4 ページ（組版済み）')).toBeInTheDocument();
    const printWindow = vi
      .spyOn(iframe.contentWindow!, 'print')
      .mockImplementation(() => {});
    vi.spyOn(iframe.contentWindow!, 'focus').mockImplementation(() => {});
    fireEvent.click(print);
    expect(printWindow).toHaveBeenCalledOnce();
  });

  it('keeps printing disabled when the pagination runtime fails', async () => {
    let fail!: (error: Error) => void;
    await preview(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await act(async () => fail(new Error('Oversized table')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ページの組版を完了できませんでした',
    );
    expect(
      screen.getByRole('button', { name: '印刷／PDF保存' }),
    ).toBeDisabled();
    expect(screen.queryByText('4 ページ（組版済み）')).not.toBeInTheDocument();
  });
});
