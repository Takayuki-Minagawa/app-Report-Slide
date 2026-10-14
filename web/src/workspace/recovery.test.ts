import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialDocument } from './initial-document';
import {
  captureRecoveryAssets,
  nextRecoveryTimestamp,
  parseWorkspaceRecovery,
  restoreRecoveryAssets,
  writeWorkspaceRecovery,
  type WorkspaceRecovery,
} from './recovery';

afterEach(() => vi.unstubAllGlobals());

describe('workspace recovery data', () => {
  it('accepts only a complete recovery envelope', () => {
    const recovery = {
      schemaVersion: 1,
      savedAt: 100,
      document: initialDocument,
      markdownDraft: '# Draft',
      markdownDirty: true,
      view: 'markdown',
      assets: [],
    } as const;

    expect(parseWorkspaceRecovery(recovery)).toEqual(recovery);
    expect(parseWorkspaceRecovery({ ...recovery, view: 'unknown' })).toBeNull();
    expect(parseWorkspaceRecovery({ ...recovery, assets: [{}] })).toBeNull();
  });

  it('uses a monotonically increasing timestamp for asynchronous copies', () => {
    const first = nextRecoveryTimestamp();
    const second = nextRecoveryTimestamp();

    expect(second).toBeGreaterThan(first);
  });

  it.each([false, true])(
    'confirms only the snapshot actually written when a newer copy exists (%s)',
    async (newerCopyExists) => {
      const snapshot: WorkspaceRecovery = {
        schemaVersion: 1,
        savedAt: 100,
        document: initialDocument,
        markdownDraft: '# Draft',
        markdownDirty: true,
        view: 'markdown',
        assets: [],
      };
      const request = {
        result: newerCopyExists ? { ...snapshot, savedAt: 200 } : undefined,
        onsuccess: null as (() => void) | null,
      };
      const put = vi.fn();
      const transaction = {
        oncomplete: null as (() => void) | null,
        objectStore: () => ({
          put,
          get: () => {
            queueMicrotask(() => {
              request.onsuccess?.();
              transaction.oncomplete?.();
            });
            return request;
          },
        }),
      };
      const close = vi.fn();
      const opened = {
        result: { transaction: () => transaction, close },
        onsuccess: null as (() => void) | null,
      };
      vi.stubGlobal('indexedDB', {
        open: () => {
          queueMicrotask(() => opened.onsuccess?.());
          return opened;
        },
      });
      await expect(writeWorkspaceRecovery(snapshot)).resolves.toBe(
        !newerCopyExists,
      );
      if (newerCopyExists) expect(put).not.toHaveBeenCalled();
      else expect(put).toHaveBeenCalledWith(snapshot, 'latest');
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('copies each local object URL once and ignores non-local URLs', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => blob,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const assets = await captureRecoveryAssets(
      new Map([
        ['first.png', 'blob:shared-image'],
        ['second.png', 'blob:shared-image'],
        ['external.png', 'https://example.invalid/image.png'],
      ]),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(assets).toEqual([
      { path: 'first.png', blob },
      { path: 'second.png', blob },
    ]);
  });

  it('recreates object URLs and releases them if recreation fails', () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    expect(() =>
      restoreRecoveryAssets([
        { path: 'first.png', blob: new Blob(['first']) },
        { path: 'second.png', blob: new Blob(['second']) },
      ]),
    ).toThrow('storage unavailable');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });
});
