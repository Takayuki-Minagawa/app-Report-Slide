import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

for (const type of ['report', 'slide']) {
  for (const original of ['embedded', 'missing', 'remote']) {
    test(`${type}/${original}: Office contains the cropped and annotated SVG appearance, not its placeholder`, async ({
      page,
    }) => {
      await page.goto('/');
      await expect(
        page.locator('[contenteditable="true"][aria-label="文書本文"]'),
      ).toBeVisible();
      const source = {
        schemaVersion: 2,
        type,
        metadata: { title: '図の出力' },
        children: [
          {
            type: 'figure',
            attrs: {
              nodeId: 'figure',
              src:
                original === 'missing'
                  ? 'missing-original.png'
                  : original === 'remote'
                    ? 'https://example.org/old-original.png'
                    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
              alt: '検証図',
              title: null,
              width: 50,
              align: 'center',
              figureEdit: {
                version: 1,
                svgSource:
                  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#2563eb"/></svg>',
                ...(type === 'report'
                  ? { imageSize: { width: 400, height: 200 } }
                  : {}),
                crop: { x: 50, y: 0, width: 50, height: 100 },
                annotations: [
                  {
                    id: 'note',
                    kind: 'rectangle',
                    x: 60,
                    y: 20,
                    x2: 90,
                    y2: 80,
                    text: '',
                    color: '#00ff00',
                    fontSize: 5,
                  },
                ],
                source: {
                  referenceId: '',
                  origin: 'concept',
                  pdfPage: '',
                  printedPage: '',
                  figureNumber: '',
                  note: '架空の図',
                },
              },
            },
          },
        ],
      };
      await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
        name: 'figure.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(source)),
      });
      const promise = page.waitForEvent('download');
      await page
        .getByRole('button', {
          name:
            type === 'slide'
              ? 'PowerPoint（.pptx）を出力'
              : 'Word（.docx）を出力',
          exact: true,
        })
        .click();
      const download = await promise;
      const chunks: Buffer[] = [];
      for await (const chunk of (await download.createReadStream())!)
        chunks.push(Buffer.from(chunk));
      const archive = unzipSync(Buffer.concat(chunks));
      const images = Object.entries(archive).filter(([name]) =>
        /^(word|ppt)\/media\/.+\.png$/.test(name),
      );
      expect(images).toHaveLength(1);
      const dataUrl =
        'data:image/png;base64,' + Buffer.from(images[0][1]).toString('base64');
      const pixels = await page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          center: Array.from(
            context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1)
              .data,
          ),
          border: Array.from(
            context.getImageData(canvas.width * 0.2, canvas.height * 0.5, 1, 1)
              .data,
          ),
        };
      }, dataUrl);
      expect(pixels.width).toBe(400);
      expect(pixels.height).toBe(400);
      expect(pixels.center).toEqual([37, 99, 235, 255]);
      expect(pixels.border[1]).toBeGreaterThan(180);
      const text = Object.entries(archive)
        .filter(([name]) => name.endsWith('.xml'))
        .map(([, bytes]) => new TextDecoder().decode(bytes))
        .join('');
      expect(text).toContain('架空の図');
    });
  }
}

test('five figure examples open only on request and render without losing stored data', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeEmpty();
  await page.locator('summary').filter({ hasText: 'サンプルを開く' }).click();
  await page.getByRole('button', { name: '図表サンプル（5ページ）' }).click();
  await expect(page.locator('.workspace-document-title')).toContainText(
    '図表を再編集する5つの作例',
  );
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.slide-preview')).toHaveCount(5);
  await expect(page.locator('.slide-preview').nth(1)).toContainText(
    '条件：同じ入力',
  );
  await expect(
    page.locator('.slide-preview').nth(1).locator('.figure-edit-graphic'),
  ).toHaveCount(1);
  await expect(page.locator('.slide-preview').nth(3)).toContainText(
    '解析（架空）',
  );
});
