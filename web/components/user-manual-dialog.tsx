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
                      '「図形で図解を作る」から矩形・楕円・文字・線・矢印を追加できます。図を選び「図形をドラッグして編集」で移動・リサイズ・接続・グループ・ロックを編集します。接続線は図形に追従し、図形用のUndo／Redoと「図へ適用」を使えます。',
                      '「SVG図解を挿入」から作る図や外部SVGはソース・ラベル・矢印を編集します。「SVGを部品に分解」で基本図形・文字・線を変換し、非対応部分と原本を保持します。プレビューで確認して適用し、原本へ戻せます。「図解・原図・出典」では元画像を残した切り抜き・注釈と共有文献も編集できます。',
                      '「PDFから図を追加」でページを選び、表示倍率・解像度・切り抜き範囲を調整します。文献の題名・著者・年・URL、論文内ページ、図表番号を確認して入力してください。PDFページ番号は自動で引き継ぎます。後から「元PDFから範囲を取り直す」で変更できます。',
                      'PDFは20 MiB・5,000ページまで。画像は800万画素・長辺4,096 pxに収まる実際のdpiへ調整します。パスワードは保存しません。「文字・表を読み取る（OCR対応）」でPDF文字／日本語・英語OCRから表と数値候補を抽出し、原本と照合・訂正して挿入できます。図の「画像の文字を読み取る」では画像OCRを使えます。原稿は外部送信せず、認識結果は確認して保存します。',
                      'PDF上部の「2. 文字・表を読み取る」から読み取り欄へ移動します。結果の表はEnter／Shift+Enterで上下、Tabで次セルへ移動できます。TSVの修正は「TSVを表に反映」で確定します。OCRは原画像の拡大・進捗・中止・再実行に対応し、未保存の変更があるときは閉じる／再実行前に確認します。',
                      'スライドデザインの「図・表・説明を領域に配置」では、名前付きの領域割当、列幅、余白、左右入替を指定できます。手動配置の図は元の位置を保ちます。',
                      'グラフは最大8系列、線種・マーカー・横棒・値ラベル・軸範囲・単位・CSV・対数軸・非対称誤差棒に対応します。図表の挿入先はツールバーで選べます。',
                      '「ブロックのまとまり・再利用」で複数選択、グループ、配置ロック、複製、部品登録を行えます。スライドの役割別書式、自由配色、余白は名前付きプリセットへ保存できます。表はセル色とページ分割に対応します。',
                      '図・表・グラフの共有文献には要点とPDF URLを登録できます。「出力比較・印刷」ではHTMLと印刷用紙を比較し、ブラウザーから検索できるPDFを保存します。未対応の取込原文はPropertiesで必要なときだけ開いて確認できます。',
                      '読者向け補足はHTMLの「詳しい説明」から開けます。図・グラフをクリックして拡大し、Escで同じページへ戻れます。',
                      'HTML／ZIPには原画像・図解部品・編集情報とPDF原本全体が含まれます。使っていないPDFページも共有対象になるため、配布前に確認してください。JSON／Markdownでは画像とPDF原本も別途必要です。Officeには図の見た目を保存しますが、PDF原本や部品の再編集情報は保持しません。「保存形式の違い」でも確認できます。',
                    ]
                  : [
                      'Open an example → Figure examples (5 pages) demonstrates diagrams, evidence with tables, comparison charts and reader supplements.',
                      'Create a shape diagram with rectangles, ellipses, text, lines and arrows. Open its shape editor to drag, resize, connect, group and lock parts. Connections follow their shapes. Use the diagram Undo/Redo controls, then apply the result to the figure.',
                      'SVG diagrams and external SVG files use source, label and arrow editing. Convert SVG to parts converts supported shapes, text and lines while retaining other elements and the original. Compare before applying and restore the original when needed. Figure properties also provide non-destructive crops, annotations and shared references.',
                      'Add figure from PDF lets you select a page, zoom, resolution and crop. Check and enter the reference title, authors, year, URL, printed page and figure number. The PDF page number is retained automatically. Reimport from the original PDF to change the selection later.',
                      'PDFs are limited to 20 MiB and 5,000 pages. Actual dpi is reduced when needed to keep page images within eight million pixels and 4,096 pixels per side. Passwords are not saved. Read text and tables (OCR) extracts PDF text or uses Japanese/English OCR. Review the original alongside editable cells and numeric candidates before inserting. Figure properties also offer image OCR. Documents stay in your browser.',
                      'Use the PDF navigation to jump to text and table reading. Enter/Shift+Enter move down/up a table column; Tab moves to the next cell. Apply TSV edits explicitly before inserting. Image OCR offers zoom, progress, cancel and retry, and asks before closing or rerunning with unsaved changes.',
                      'Choose composite regions in slide design to name and assign blocks, adjust column width and gaps, and swap columns. Manual figure coordinates remain protected.',
                      'Charts support up to eight series, styles, markers, horizontal bars, value labels, axis ranges, units, CSV, logarithmic axes and asymmetric error bars. Choose the insertion target in the toolbar.',
                      'Use block groups to select, group, lock placement, duplicate and register reusable parts. Save role styles, colors and spacing as named slide presets. Tables support cell colors and splitting across pages.',
                      'References on figures, tables and charts can include summaries and PDF URLs. Compare / Print switches between HTML and print sheets and opens the browser print dialog for searchable PDF. Inspect retained unsupported source only when needed in Properties.',
                      'HTML readers open Details or click a figure to enlarge it. Escape returns to the same page.',
                      'HTML and ZIP keep original images, diagram parts, editing data and complete PDF originals, including unused pages. Check the full PDF before sharing. JSON/Markdown also need the image and PDF files separately. Office keeps the visible figures but does not retain PDF originals or editable diagram parts. Save format details explains each format.',
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
