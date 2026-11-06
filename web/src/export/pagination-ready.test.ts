import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForReportPagination } from './pagination-ready';

afterEach(() => vi.useRealTimers());

function frameDocument() {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<div class="pagedjs_page"></div>';
  return { frame, doc };
}

describe('shared pagination readiness', () => {
  it('rejects a missing runtime instead of using provisional source pages', async () => {
    const { frame, doc } = frameDocument();
    try {
      await expect(waitForReportPagination(doc)).rejects.toThrow(
        'did not start',
      );
    } finally {
      frame.remove();
    }
  });

  it('forwards runtime failures', async () => {
    const { frame, doc } = frameDocument();
    Object.assign(doc.defaultView!, {
      kumiPaginationReady: Promise.reject(new Error('Table cannot fit')),
    });
    try {
      await expect(waitForReportPagination(doc)).rejects.toThrow(
        'Table cannot fit',
      );
    } finally {
      frame.remove();
    }
  });

  it('requires a ready layout and a valid completed page count', async () => {
    const { frame, doc } = frameDocument();
    Object.assign(doc.defaultView!, {
      kumiPaginationReady: Promise.resolve({ pageCount: 1, bodyPageCount: 0 }),
    });
    try {
      await expect(waitForReportPagination(doc)).rejects.toThrow('incomplete');
      doc.documentElement.dataset.kumiPagination = 'ready';
      await expect(waitForReportPagination(doc)).resolves.toEqual({
        pageCount: 1,
        bodyPageCount: 0,
      });
    } finally {
      frame.remove();
    }
  });

  it('times out a stalled layout', async () => {
    vi.useFakeTimers();
    const { frame, doc } = frameDocument();
    Object.assign(doc.defaultView!, {
      kumiPaginationReady: new Promise(() => {}),
    });
    try {
      const rejected = expect(
        waitForReportPagination(doc, 100),
      ).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
    } finally {
      frame.remove();
    }
  });
});
