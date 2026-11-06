export interface ReportPaginationResult {
  pageCount: number;
  bodyPageCount: number;
}

/** Consumers wait for the same completed layout before printing or capturing it. */
export async function waitForReportPagination(
  document: Document,
  // Runtime allows 30 seconds for resources followed by 60 seconds for layout.
  timeoutMs = 100_000,
): Promise<ReportPaginationResult> {
  const runtime = document.defaultView as
    | (Window & {
        kumiPaginationReady?: Promise<ReportPaginationResult>;
      })
    | null;
  if (!runtime?.kumiPaginationReady)
    throw new Error('Report pagination did not start.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      runtime.kumiPaginationReady,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Report pagination timed out.')),
          timeoutMs,
        );
      }),
    ]);
    if (
      !Number.isSafeInteger(result?.pageCount) ||
      result.pageCount < 1 ||
      !Number.isSafeInteger(result.bodyPageCount) ||
      result.bodyPageCount < 0 ||
      result.bodyPageCount > result.pageCount ||
      document.querySelectorAll('.pagedjs_page').length !== result.pageCount ||
      document.documentElement.dataset.kumiPagination !== 'ready'
    )
      throw new Error('Report pagination is incomplete.');
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
