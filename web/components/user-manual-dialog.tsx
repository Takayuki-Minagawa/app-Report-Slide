'use client';

import { CircleHelp } from 'lucide-react';

import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

function ManualSection({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function UserManualDialog() {
  const { copy, locale } = useAppPreferences();
  const { manual } = copy;

  return (
    <Dialog>
      <DialogTrigger
        render={<Button size="sm" variant="ghost" />}
        aria-label={copy.app.manual}
        title={copy.app.manual}
      >
        <CircleHelp data-icon="inline-start" />
        {copy.app.manual}
      </DialogTrigger>
      <DialogContent
        className="max-w-[min(42rem,calc(100%-2rem))] gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>{manual.title}</DialogTitle>
          <DialogDescription>{manual.description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(34rem,calc(100dvh-12rem))]">
          <div className="space-y-6 px-6 py-5 text-sm leading-6">
            <ManualSection
              title={manual.startTitle}
              items={manual.startSteps}
            />
            <ManualSection title={manual.editTitle} items={manual.editSteps} />
            <ManualSection
              title={manual.tableTitle}
              items={manual.tableSteps}
            />
            <ManualSection
              title={manual.exportTitle}
              items={manual.exportSteps}
            />
            <ManualSection
              title={manual.preferencesTitle}
              items={manual.preferencesSteps}
            />
            <ManualSection
              title={manual.projectTitle}
              items={manual.projectSteps}
            />
            <ManualSection
              title={manual.recoveryTitle}
              items={manual.recoverySteps}
            />
            <ManualSection
              title={
                locale === 'ja'
                  ? '8. 図表を作って再編集する'
                  : '8. Create and re-edit figures'
              }
              items={
                locale === 'ja'
                  ? [
                      'サンプルを開く → 図表サンプル（5ページ）で、図解、原図＋表、比較グラフ、補足を試せます。',
                      'SVG図解を挿入し、図を選んで「図解・原図・出典」からラベル、矢印、原画像の切り抜き・注釈を編集します。共有文献を保存して図へ関連付けると、同じ文献を使う図へ訂正が反映されます。',
                      'スライドデザインの「図・表・説明を領域に配置」では、名前付きの領域割当、列幅、余白、左右入替を指定できます。手動配置の図は元の位置を保ちます。',
                      'グラフは最大8系列、線種・マーカー・横棒・値ラベル・軸範囲・単位・CSVに対応します。図表の挿入先はツールバーで選べます。',
                      '読者向け補足はHTMLの「詳しい説明」から開けます。図・グラフをクリックして拡大し、Escで同じページへ戻れます。',
                      'HTML／ZIPに保存すると原画像と編集情報を持ち運べます。「保存形式の違い」で現在の図表が各形式にどこまで残るかを確認してください。',
                    ]
                  : [
                      'Open an example → Figure examples (5 pages) demonstrates diagrams, evidence with tables, comparison charts and reader supplements.',
                      'Insert an SVG diagram, then edit its source, labels, arrows, non-destructive crop, annotations and shared reference from figure properties.',
                      'Choose composite regions in slide design to name and assign blocks, adjust column width and gaps, and swap columns. Manual figure coordinates remain protected.',
                      'Charts support up to eight series, styles, markers, horizontal bars, value labels, axis ranges, units and CSV. Choose the insertion target in the toolbar.',
                      'HTML readers open Details or click a figure to enlarge it. Escape returns to the same page.',
                      'Save HTML or ZIP to carry original images and editing data together. Save format details explains the limits for each format.',
                    ]
              }
            />
            <section className="rounded-md border bg-muted/30 p-3">
              <h3 className="font-semibold">{manual.privacyTitle}</h3>
              <p className="mt-1 text-muted-foreground">{manual.privacyText}</p>
            </section>
          </div>
        </ScrollArea>
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4">
          <DialogClose render={<Button variant="outline" />}>
            {copy.app.close}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
