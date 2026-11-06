import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { defaultPageSettings } from '@/src/document/page-settings';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportReportHtml } from '@/src/export/report-html';
import {
  waitForReportPagination,
  type ReportPaginationResult,
} from '@/src/export/pagination-ready';
import { PhysicalReportPreview } from './physical-report-preview';

vi.mock('@/src/export/report-html', () => ({ exportReportHtml: vi.fn() }));
vi.mock('@/src/export/pagination-ready', () => ({
  waitForReportPagination: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const exportResult = (name: string) => ({
  html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head><body>${name}</body></html>`,
  externalImages: [],
});

const firstDocument = () => parseMarkdown('# First\n\nBody').document;
const secondDocument = () => parseMarkdown('# Second\n\nNew body').document;

function loadReportFrame(frame: HTMLElement) {
  const doc = (frame as HTMLIFrameElement).contentDocument!;
  doc.documentElement.dataset.kumiPagination = 'pending';
  fireEvent.load(frame);
}

describe('physical report preview', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'ja';
    vi.mocked(exportReportHtml).mockReset();
    vi.mocked(waitForReportPagination).mockReset();
    vi.mocked(exportReportHtml).mockResolvedValue(exportResult('Report'));
    vi.mocked(waitForReportPagination).mockResolvedValue({
      pageCount: 7,
      bodyPageCount: 5,
    });
  });

  it('embeds the same exported HTML and reveals only the completed physical count', async () => {
    const pagination = deferred<ReportPaginationResult>();
    vi.mocked(waitForReportPagination).mockReturnValue(pagination.promise);
    const source = parseMarkdown(
      '# Images\n\n![Figure](figure.svg)\n\n> Inline ![small](inline.png)',
    ).document;
    source.metadata.page_settings = {
      ...defaultPageSettings,
      paper: 'A5',
      orientation: 'landscape',
    };
    const resolveImageUrl = vi.fn((path: string) => `blob:${path}`);
    render(
      <AppPreferencesProvider>
        <PhysicalReportPreview
          document={source}
          resolveImageUrl={resolveImageUrl}
        />
      </AppPreferencesProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '用紙に合わせて組版しています…',
    );
    expect(screen.queryByText(/明示的改ページ/)).not.toBeInTheDocument();
    const frame = await screen.findByTitle<HTMLIFrameElement>(
      '組版後のレポートプレビュー',
    );
    expect(exportReportHtml).toHaveBeenCalledWith(
      source,
      new Map([
        ['figure.svg', 'blob:figure.svg'],
        ['inline.png', 'blob:inline.png'],
      ]),
      'ja',
    );
    expect(frame).toHaveAttribute('srcdoc', exportResult('Report').html);
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-modals allow-popups',
    );
    expect(frame).toHaveStyle({
      visibility: 'hidden',
      width: 'calc(210mm + 64px)',
      maxWidth: 'none',
    });
    expect(frame.parentElement).toHaveClass('overflow-x-auto');
    loadReportFrame(frame);
    expect(waitForReportPagination).toHaveBeenCalledWith(frame.contentDocument);
    expect(screen.queryByText(/7 ページ/)).not.toBeInTheDocument();
    await act(async () =>
      pagination.resolve({ pageCount: 7, bodyPageCount: 5 }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('7 ページ（組版後）');
    expect(frame).toHaveStyle({ visibility: 'visible' });
    expect(frame).toHaveAttribute('aria-hidden', 'false');
  });

  it('discards an old export after the source document changes', async () => {
    const earlier = deferred<Awaited<ReturnType<typeof exportReportHtml>>>();
    vi.mocked(exportReportHtml)
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(exportResult('Second'));
    const first = firstDocument();
    const { rerender } = render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={first} />
      </AppPreferencesProvider>,
    );
    await waitFor(() => expect(exportReportHtml).toHaveBeenCalledTimes(1));
    rerender(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={secondDocument()} />
      </AppPreferencesProvider>,
    );
    const frame = await screen.findByTitle('組版後のレポートプレビュー');
    expect(frame).toHaveAttribute('srcdoc', exportResult('Second').html);
    await act(async () => earlier.resolve(exportResult('First')));
    expect(frame).toHaveAttribute('srcdoc', exportResult('Second').html);
  });

  it('discards pagination from an older frame and rebuilds after assets change', async () => {
    const earlier = deferred<ReportPaginationResult>();
    const latest = deferred<ReportPaginationResult>();
    vi.mocked(waitForReportPagination)
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(latest.promise);
    const source = parseMarkdown('![image](image.png)').document;
    const { rerender } = render(
      <AppPreferencesProvider>
        <PhysicalReportPreview
          document={source}
          resolveImageUrl={() => 'blob:old'}
        />
      </AppPreferencesProvider>,
    );
    const previousFrame = await screen.findByTitle(
      '組版後のレポートプレビュー',
    );
    loadReportFrame(previousFrame);
    rerender(
      <AppPreferencesProvider>
        <PhysicalReportPreview
          document={source}
          resolveImageUrl={() => 'blob:new'}
        />
      </AppPreferencesProvider>,
    );
    expect(previousFrame).not.toBeInTheDocument();
    const frame = await screen.findByTitle('組版後のレポートプレビュー');
    loadReportFrame(frame);
    await act(async () =>
      earlier.resolve({ pageCount: 90, bodyPageCount: 90 }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '用紙に合わせて組版しています…',
    );
    expect(frame).toHaveStyle({ visibility: 'hidden' });
    await act(async () => latest.resolve({ pageCount: 3, bodyPageCount: 3 }));
    expect(screen.getByRole('status')).toHaveTextContent('3 ページ（組版後）');
    expect(exportReportHtml).toHaveBeenLastCalledWith(
      source,
      new Map([['image.png', 'blob:new']]),
      'ja',
    );
  });

  it('clears a completed count immediately when the document changes', async () => {
    const { rerender } = render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    loadReportFrame(await screen.findByTitle('組版後のレポートプレビュー'));
    await screen.findByText('7 ページ（組版後）');
    const next = deferred<Awaited<ReturnType<typeof exportReportHtml>>>();
    vi.mocked(exportReportHtml).mockReturnValue(next.promise);
    rerender(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={secondDocument()} />
      </AppPreferencesProvider>,
    );
    expect(screen.queryByText('7 ページ（組版後）')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('組版後のレポートプレビュー'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '用紙に合わせて組版しています…',
    );
  });

  it('reports export failures in Japanese and allows a fresh attempt', async () => {
    vi.mocked(exportReportHtml).mockRejectedValueOnce(
      new Error('Export failed'),
    );
    render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'レポートを組版できませんでした。',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Export failed');
    expect(
      screen.queryByTitle('組版後のレポートプレビュー'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    loadReportFrame(await screen.findByTitle('組版後のレポートプレビュー'));
    expect(await screen.findByText('7 ページ（組版後）')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('localizes pending and pagination errors in English without showing an estimated count', async () => {
    window.localStorage.setItem('kumi.locale', 'en');
    const pagination = deferred<ReportPaginationResult>();
    vi.mocked(waitForReportPagination).mockReturnValue(pagination.promise);
    render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    const frame = await screen.findByTitle('Paginated report preview');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Laying out the report for print…',
    );
    loadReportFrame(frame);
    await act(async () =>
      pagination.reject(new Error('Pagination incomplete')),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The report could not be laid out.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pagination incomplete',
    );
    expect(screen.queryByText(/physical pages?/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(frame).not.toBeInTheDocument();
  });

  it('ignores an old pagination failure after a replacement frame succeeds', async () => {
    const earlier = deferred<ReportPaginationResult>();
    vi.mocked(waitForReportPagination).mockReturnValueOnce(earlier.promise);
    const { rerender } = render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    loadReportFrame(await screen.findByTitle('組版後のレポートプレビュー'));
    rerender(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={secondDocument()} />
      </AppPreferencesProvider>,
    );
    loadReportFrame(await screen.findByTitle('組版後のレポートプレビュー'));
    await screen.findByText('7 ページ（組版後）');
    await act(async () => earlier.reject(new Error('Old timeout')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('7 ページ（組版後）');
  });

  it('does not resume a pending export after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof exportReportHtml>>>();
    vi.mocked(exportReportHtml).mockReturnValue(pending.promise);
    const { unmount } = render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    await waitFor(() => expect(exportReportHtml).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () =>
      pending.resolve(exportResult('Finished after unmount')),
    );
    expect(
      screen.queryByTitle('組版後のレポートプレビュー'),
    ).not.toBeInTheDocument();
    expect(waitForReportPagination).not.toHaveBeenCalled();
  });

  it('ignores an initial empty iframe load and waits for the real srcdoc', async () => {
    render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    const frame = await screen.findByTitle<HTMLIFrameElement>(
      '組版後のレポートプレビュー',
    );
    expect(
      frame.contentDocument!.documentElement.dataset.kumiPagination,
    ).toBeUndefined();
    fireEvent.load(frame);
    expect(waitForReportPagination).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '用紙に合わせて組版しています…',
    );
    loadReportFrame(frame);
    expect(await screen.findByText('7 ページ（組版後）')).toBeInTheDocument();
    expect(waitForReportPagination).toHaveBeenCalledTimes(1);
  });

  it('shows the error message rejected by an iframe from another realm', async () => {
    // A cross-realm Error does not pass `instanceof Error` in the parent window.
    vi.mocked(waitForReportPagination).mockRejectedValue({
      message: 'Report pagination did not start.',
    });
    render(
      <AppPreferencesProvider>
        <PhysicalReportPreview document={firstDocument()} />
      </AppPreferencesProvider>,
    );
    loadReportFrame(await screen.findByTitle('組版後のレポートプレビュー'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Report pagination did not start.',
    );
  });
});
