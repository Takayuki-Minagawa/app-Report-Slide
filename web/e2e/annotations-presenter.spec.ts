import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// Includes a cold app load, a download and an offline deck with a popup.
test.setTimeout(90_000);

test('脚注・注記・発表者ノートを編集し、HTMLスライドの一覧・ノート・発表者ビューで使用できる', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const body = page.locator('[contenteditable="true"][aria-label="文書本文"]');
  await expect(body).toBeVisible();

  await page.getByLabel('Markdownファイル').setInputFiles([
    {
      name: 'talk.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        [
          '---',
          'type: slide',
          'title: 発表テスト',
          '---',
          '',
          '# 概要',
          '',
          '解析条件[^cond]を示す。',
          '',
          '[^cond]: 告示波を使用。',
          '',
          '> [!WARNING]',
          '> 変形角に注意。',
          '',
          '::: notes',
          'ここで条件を説明する。',
          '',
          ...Array.from({ length: 12 }, (_, index) => [
            `補足 ${index + 1}: 長いノートでもスライドは画面に収まる。`,
            '',
          ]).flat(),
          ':::',
          '',
          '::: slidebreak',
          ':::',
          '',
          '# 結果',
          '',
          '最大変位は 24.5 mm。',
          '',
          '::: slidebreak',
          ':::',
          '',
          '# まとめ',
        ].join('\n'),
      ),
    },
  ]);
  await expect(body.locator('sup.kumi-footnote')).toHaveCount(1);
  await expect(
    body.locator('blockquote[data-callout="warning"]'),
  ).toBeVisible();
  await expect(body.locator('aside.kumi-speaker-notes')).toContainText(
    'ここで条件を説明する。',
  );

  // A second footnote from the toolbar, edited in Properties.
  await body.getByText('最大変位は 24.5 mm。').click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: '脚注を挿入', exact: true }).click();
  const footnoteText = page.getByRole('textbox', { name: '脚注の本文' });
  await expect(footnoteText).toHaveValue('脚注の本文');
  await footnoteText.fill('2階の値。');
  await page.getByRole('button', { name: '脚注を更新', exact: true }).click();
  await expect(body.locator('sup.kumi-footnote')).toHaveCount(2);
  await expect(body.locator('sup.kumi-footnote').nth(1)).toHaveAttribute(
    'data-footnote',
    '2階の値。',
  );

  // Notes for the second slide go to the end of that slide.
  await page
    .getByRole('button', { name: '発表者ノートを追加', exact: true })
    .click();
  await page.keyboard.type('結果は表で補足する。');
  await expect(body.locator('aside.kumi-speaker-notes')).toHaveCount(2);

  await page
    .getByRole('button', { name: 'Markdownへ切り替え', exact: true })
    .click();
  const markdown = await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .inputValue();
  expect(markdown).toContain('解析条件^[告示波を使用。]を示す。');
  expect(markdown).toContain('> [!WARNING]\n> 変形角に注意。');
  expect(markdown).toContain('最大変位は 24.5 mm。^[2階の値。]');
  expect(markdown).toContain(
    '::: notes\n結果は表で補足する。\n:::\n\n::: slidebreak',
  );

  await page
    .getByRole('button', { name: '完成プレビューへ切り替え', exact: true })
    .click();
  const firstSlide = page.getByLabel('スライドプレビュー').first();
  await expect(firstSlide.locator('.callout-title')).toHaveText('警告');
  await expect(firstSlide.getByRole('list', { name: '脚注' })).toContainText(
    '告示波を使用。',
  );
  await expect(firstSlide).not.toContainText('ここで条件を説明する。');

  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'HTMLスライドを出力', exact: true })
    .click();
  const exportedPath = testInfo.outputPath('talk.html');
  await (await downloadPromise).saveAs(exportedPath);

  const offline = await browser.newContext({ offline: true });
  try {
    const deck = await offline.newPage();
    deck.on('pageerror', (error) => errors.push(error.message));
    deck.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await deck.goto(pathToFileURL(exportedPath).href);
    await expect(deck.locator('#slide-1')).toBeVisible();
    await expect(deck.locator('#slide-1')).not.toContainText(
      'ここで条件を説明する。',
    );

    // Footnote links stay on their slide.
    await deck.locator('#slide-1 .footnote-ref a').click();
    await expect(deck.locator('#slide-1')).toBeVisible();
    await expect(deck.locator('#deck-counter')).toHaveText('1 / 3');

    // Number + Enter, then the overview.
    await deck.keyboard.press('3');
    await expect(deck.locator('#deck-status')).toContainText('3');
    await deck.keyboard.press('Enter');
    await expect(deck.locator('#slide-3')).toBeVisible();
    await expect(deck.locator('#slide-1')).toBeHidden();
    await deck.keyboard.press('o');
    for (const id of ['#slide-1', '#slide-2', '#slide-3'])
      await expect(deck.locator(id)).toBeVisible();
    const thumbnail = await deck.locator('#slide-2').boundingBox();
    expect(thumbnail!.width).toBeCloseTo(230, 0);
    const neighbour = await deck.locator('#slide-3').boundingBox();
    expect(
      neighbour!.x >= thumbnail!.x + thumbnail!.width ||
        neighbour!.y >= thumbnail!.y + thumbnail!.height,
    ).toBe(true);
    await deck.locator('#slide-2').click();
    await expect(deck.locator('#slide-2')).toBeVisible();
    await expect(deck.locator('#slide-3')).toBeHidden();
    await expect(deck.locator('#deck-counter')).toHaveText('2 / 3');

    // Notes panel: the slide still fits above it.
    await deck.keyboard.press('n');
    const notes = deck.getByRole('region', { name: '発表者ノート' });
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('結果は表で補足する。');
    const slideBox = await deck.locator('#slide-2').boundingBox();
    const notesBox = await notes.boundingBox();
    expect(slideBox!.y + slideBox!.height).toBeLessThanOrEqual(notesBox!.y + 1);
    await deck.keyboard.press('ArrowRight');
    await expect(notes).toContainText('このスライドにノートはありません。');
    // Longer notes take more room: the slide is fitted again for each slide.
    await deck.keyboard.press('Home');
    await expect(notes).toContainText('補足 12');
    const tallNotes = await notes.boundingBox();
    const fitted = await deck.locator('#slide-1').boundingBox();
    expect(tallNotes!.height).toBeGreaterThan(notesBox!.height);
    expect(fitted!.y + fitted!.height).toBeLessThanOrEqual(tallNotes!.y + 1);
    expect(fitted!.height).toBeLessThan(slideBox!.height);
    await deck.keyboard.press('End');
    await deck.getByRole('button', { name: 'ノート', exact: true }).click();
    await expect(notes).toBeHidden();

    await deck.keyboard.press('b');
    await expect(deck.locator('#deck-stage')).toBeHidden();
    await deck.keyboard.press('b');
    await expect(deck.locator('#deck-stage')).toBeVisible();

    // The presenter window is filled by the deck and drives it with keys.
    await deck.keyboard.press('Home');
    const popupPromise = deck.waitForEvent('popup');
    await deck
      .getByRole('button', { name: '発表者ビュー', exact: true })
      .click();
    const presenter = await popupPromise;
    presenter.on('pageerror', (error) => errors.push(error.message));
    await expect(presenter).toHaveTitle('発表者ビュー — 発表テスト');
    await expect(presenter.locator('#presenter-current')).toContainText('概要');
    await expect(presenter.locator('#presenter-next')).toContainText('結果');
    await expect(presenter.locator('#presenter-notes')).toContainText(
      'ここで条件を説明する。',
    );
    // A footnote link in the presenter window must not load a second deck there.
    await presenter.locator('#presenter-current .footnote-ref a').click();
    await expect(presenter).toHaveURL('about:blank');
    await expect(presenter.locator('#presenter-current')).toContainText('概要');
    await expect(presenter.locator('#presenter-counter')).toHaveText('1 / 3');
    const frame = await presenter.locator('#presenter-current').boundingBox();
    expect(frame!.width).toBeCloseTo(552, 0);
    await expect(
      presenter.locator('#presenter-current .slide-preview'),
    ).toHaveCSS('background-color', 'rgb(255, 254, 253)');
    await presenter.keyboard.press('ArrowRight');
    await expect(deck.locator('#slide-2')).toBeVisible();
    await expect(presenter.locator('#presenter-current')).toContainText('結果');
    await expect(presenter.locator('#presenter-notes')).toHaveText(
      '結果は表で補足する。',
    );
    await expect(presenter.locator('#presenter-timer')).toHaveText(
      /^\d{2}:\d{2}$/,
    );
    await presenter.keyboard.press('End');
    await expect(presenter.locator('#presenter-next')).toBeEmpty();
    await expect(deck.locator('#deck-counter')).toHaveText('3 / 3');

    await deck.emulateMedia({ media: 'print' });
    for (const id of ['#slide-1', '#slide-2', '#slide-3'])
      await expect(deck.locator(id)).toBeVisible();
    await expect(notes).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await offline.close();
  }
});
