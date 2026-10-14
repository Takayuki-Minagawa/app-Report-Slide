import { expect, test, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function waitForEditor(page: Page): Promise<void> {
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
}

async function hasRecoveryCopy(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase | null>(
      (resolve, reject) => {
        const request = window.indexedDB.open('kumi-workspace-recovery', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    if (!database || !database.objectStoreNames.contains('drafts'))
      return false;
    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction('drafts', 'readonly')
          .objectStore('drafts')
          .get('latest');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return record !== undefined;
    } finally {
      database.close();
    }
  });
}

test('端末内の復旧用保存から未保存の単独文書を復元できる', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  const restoredText = '復旧確認用の追記';
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(restoredText);
  await expect(page.getByLabel('未保存')).toBeVisible();
  await expect.poll(() => hasRecoveryCopy(page)).toBe(true);

  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') void dialog.accept();
  });
  await page.reload();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '未保存の作業を確認' }).click();

  const recoveryDialog = page
    .getByRole('dialog')
    .filter({ hasText: '未保存の作業が見つかりました' });
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog.getByRole('button', { name: '復元する' }).click();
  await expect(page.locator('.kumi-editor-content')).toContainText(
    restoredText,
  );
  await expect(page.getByLabel('未保存')).toBeVisible();
});

test('未適用Markdown下書きを端末内の復旧用保存から復元できる', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  const draft =
    '---\\ntype: report\\ntitle: 復旧用Markdown下書き\\n---\\n\\n# 未適用の見出し\\n\\n本文';
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  await source.fill(draft);
  await expect(page.getByLabel('未保存')).toBeVisible();
  await expect.poll(() => hasRecoveryCopy(page)).toBe(true);

  page.on('dialog', (dialog) => {
    if (dialog.type() === 'beforeunload') void dialog.accept();
  });
  await page.reload();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '未保存の作業を確認' }).click();

  const recoveryDialog = page
    .getByRole('dialog')
    .filter({ hasText: '未保存の作業が見つかりました' });
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog.getByRole('button', { name: '復元する' }).click();
  await expect(source).toHaveValue(draft);
  await expect(page.getByLabel('未保存')).toBeVisible();
});

test('狭幅時もヘッダーから文書一覧とPropertiesを開ける', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: '文書パネルを開く' }).click();
  const navigatorSheet = page.getByRole('dialog', { name: 'DOCUMENT' });
  await expect(navigatorSheet).toBeVisible();
  await expect(
    navigatorSheet.getByRole('navigation', { name: '文書構成' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(navigatorSheet).not.toBeVisible();

  await page.getByRole('button', { name: 'Propertiesを開く' }).click();
  const propertiesSheet = page.getByRole('dialog', { name: 'PROPERTIES' });
  await expect(propertiesSheet).toBeVisible();
  await expect(
    propertiesSheet.getByRole('combobox', { name: 'テーマ' }),
  ).toBeVisible();
});

test('復元候補を閉じても保持し、新しい作業を別に一時保存する', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await expect(editor).toHaveText('');
  await editor.fill('以前の未保存作業');
  await expect.poll(() => hasRecoveryCopy(page)).toBe(true);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.reload();
  await waitForEditor(page);
  await expect(editor).toHaveText('');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '未保存の作業を確認' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '未保存の作業が見つかりました',
  );
  await page.getByRole('button', { name: '閉じる（候補を保持）' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await editor.fill('新しい未保存作業');
  await expect.poll(() => hasRecoveryCopy(page)).toBe(true);
  const copies = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('kumi-workspace-recovery', 1);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<string[]>((resolve) => {
        const request = db.transaction('drafts').objectStore('drafts').getAll();
        request.onsuccess = () =>
          resolve(request.result.map((value) => JSON.stringify(value)));
      });
    } finally {
      db.close();
    }
  });
  expect(copies.some((value) => value.includes('以前の未保存作業'))).toBe(true);
  expect(copies.some((value) => value.includes('新しい未保存作業'))).toBe(true);
  await page.reload();
  await waitForEditor(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '未保存の作業を確認' }).click();
  await expect(
    page.getByRole('combobox', { name: '復元候補' }).locator('option'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: '復元する', exact: true }).click();
  await expect(editor).toHaveText('新しい未保存作業');
  // A successful restore must not delete its durable source before autosave.
  await page.getByRole('button', { name: '未保存の作業を確認' }).click();
  await expect(
    page.getByRole('combobox', { name: '復元候補' }).locator('option'),
  ).toHaveCount(2);
  const retainedHistory = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('kumi-workspace-recovery', 1);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<number>((resolve) => {
        const request = db
          .transaction('drafts')
          .objectStore('drafts')
          .getAllKeys();
        request.onsuccess = () =>
          resolve(
            request.result.filter(
              (key) => typeof key === 'string' && key.startsWith('history:'),
            ).length,
          );
      });
    } finally {
      db.close();
    }
  });
  expect(retainedHistory).toBe(2);
});
