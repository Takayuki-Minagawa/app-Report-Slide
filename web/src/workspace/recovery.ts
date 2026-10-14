import type { DocumentData } from '@/src/document/model';
import type { ReportProject } from '@/src/project/model';
import { registerAssetUrl, revokeAssetUrls, type AssetUrls } from './files';

const databaseName = 'kumi-workspace-recovery';
const storeName = 'drafts';
const latestDraftKey = 'latest';
const recoverySchemaVersion = 1;

let lastTimestamp = 0;

export type RecoveryView = 'visual' | 'layout' | 'markdown' | 'preview';

export interface RecoveryAsset {
  path: string;
  blob: Blob;
}

/** A device-local crash-recovery copy. It is never an export or a source of truth. */
export interface WorkspaceRecovery {
  schemaVersion: typeof recoverySchemaVersion;
  savedAt: number;
  document: DocumentData;
  markdownDraft: string;
  markdownDirty: boolean;
  view: RecoveryView;
  project?: {
    project: ReportProject;
    activeChapterId: string;
  };
  assets: RecoveryAsset[];
}

function browserDatabase(): IDBFactory | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecoveryView(value: unknown): value is RecoveryView {
  return (
    value === 'visual' ||
    value === 'layout' ||
    value === 'markdown' ||
    value === 'preview'
  );
}

function isRecoveryAsset(value: unknown): value is RecoveryAsset {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    typeof Blob !== 'undefined' &&
    value.blob instanceof Blob
  );
}

/** Checks only the envelope; document and project validation remain with their owners. */
export function parseWorkspaceRecovery(
  value: unknown,
): WorkspaceRecovery | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== recoverySchemaVersion ||
    !Number.isFinite(value.savedAt) ||
    !isRecord(value.document) ||
    typeof value.markdownDraft !== 'string' ||
    typeof value.markdownDirty !== 'boolean' ||
    !isRecoveryView(value.view) ||
    !Array.isArray(value.assets) ||
    !value.assets.every(isRecoveryAsset)
  )
    return null;

  if (value.project !== undefined) {
    if (
      !isRecord(value.project) ||
      !isRecord(value.project.project) ||
      typeof value.project.activeChapterId !== 'string'
    )
      return null;
  }

  return value as unknown as WorkspaceRecovery;
}

/** Monotonic timestamps prevent a slower image copy from overwriting a newer draft. */
export function nextRecoveryTimestamp(): number {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  return lastTimestamp;
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = browserDatabase();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, recoverySchemaVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName))
        database.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** Returns null when browser storage is unavailable or no usable recovery copy exists. */
export async function readWorkspaceRecovery(): Promise<WorkspaceRecovery | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(latestDraftKey);
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB read failed'));
    });
    await transactionComplete(transaction);
    return parseWorkspaceRecovery(value);
  } finally {
    database.close();
  }
}

/** Stores only a newer snapshot, so asynchronously copied images cannot roll back recovery. */
export async function writeWorkspaceRecovery(
  recovery: WorkspaceRecovery,
): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.get(latestDraftKey);
    request.onsuccess = () => {
      const current = parseWorkspaceRecovery(request.result);
      if (!current || current.savedAt <= recovery.savedAt)
        store.put(recovery, latestDraftKey);
    };
    request.onerror = () => transaction.abort();
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function clearWorkspaceRecovery(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(latestDraftKey);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

/** Move the last session to its own key before enabling this session's autosave.
 * Hiding a recovery candidate must neither delete it nor freeze new backups.
 */
export async function prepareWorkspaceRecoveries(): Promise<
  WorkspaceRecovery[]
> {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    const store = transaction.objectStore(storeName);
    const request = store.get(latestDraftKey);
    request.onsuccess = () => {
      const latest = parseWorkspaceRecovery(request.result);
      if (latest) store.put(latest, `history:${latest.savedAt}`);
      store.delete(latestDraftKey);
    };
    request.onerror = () => transaction.abort();
    await complete;
    const reading = database.transaction(storeName, 'readonly');
    const readComplete = transactionComplete(reading);
    const all = reading.objectStore(storeName).getAll();
    const values = await new Promise<unknown[]>((resolve, reject) => {
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
    await readComplete;
    return values
      .map(parseWorkspaceRecovery)
      .filter((value): value is WorkspaceRecovery => value !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    database.close();
  }
}

/** Explicit restore/discard affects only the selected previous session. */
export async function removeWorkspaceRecovery(savedAt: number): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).delete(`history:${savedAt}`);
    await complete;
  } finally {
    database.close();
  }
}

/** Copies object URLs into Blobs so a recovery record remains valid after the page is closed. */
export async function captureRecoveryAssets(
  assets: AssetUrls,
): Promise<RecoveryAsset[]> {
  const blobByUrl = new Map<string, Promise<Blob | null>>();
  const records = await Promise.all(
    [...assets].map(async ([path, url]) => {
      if (!url.startsWith('blob:')) return null;
      let copy = blobByUrl.get(url);
      if (!copy) {
        copy = fetch(url)
          .then(async (response) => (response.ok ? response.blob() : null))
          .catch(() => null);
        blobByUrl.set(url, copy);
      }
      const blob = await copy;
      return blob ? { path, blob } : null;
    }),
  );
  return records.filter((record): record is RecoveryAsset => record !== null);
}

export function restoreRecoveryAssets(
  assets: readonly RecoveryAsset[],
): AssetUrls {
  const urls = new Map<string, string>();
  try {
    for (const asset of assets) {
      if (!asset.path || urls.has(asset.path)) continue;
      urls.set(
        asset.path,
        registerAssetUrl(URL.createObjectURL(asset.blob), asset.blob.size),
      );
    }
    return urls;
  } catch (error) {
    revokeAssetUrls(urls);
    throw error;
  }
}
