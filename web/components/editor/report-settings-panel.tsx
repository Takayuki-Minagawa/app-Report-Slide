'use client';

import { useId, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { DocumentMetadata } from '@/src/document/model';
import {
  reportSettingsSchema,
  resolveReportSettings,
  storedReportSettings,
} from '@/src/document/report-settings';
import { calloutTypes } from '@/src/document/model';
import { calloutLabel } from '@/src/document/format';
import { hasCssOnlyStyle } from '@/src/document/report-style';

/** Report-level settings are shared by all chapters; they never insert source blocks. */
export function ReportSettingsPanel({
  metadata,
  disabled,
  onApply,
}: {
  metadata: DocumentMetadata;
  disabled: boolean;
  onApply: (metadata: DocumentMetadata) => void;
}) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [settings, setSettings] = useState(() =>
    resolveReportSettings(metadata),
  );
  const [fields, setFields] = useState(() => ({
    title: metadata.title ?? '',
    subtitle: metadata.subtitle ?? '',
    author: metadata.author ?? '',
    date: metadata.date ?? '',
  }));
  const [toc, setToc] = useState(metadata.toc === true);
  const [numberSections, setNumberSections] = useState(
    metadata.number_sections === true,
  );
  const [error, setError] = useState(false);
  const id = useId();
  const textFields = ja
    ? {
        title: '報告書の題名',
        subtitle: '副題',
        author: '著者',
        date: '提出日',
      }
    : {
        title: 'Report title',
        subtitle: 'Subtitle',
        author: 'Author',
        date: 'Report date',
      };
  const coverFields = ja
    ? { affiliation: '所属', recipient: '提出先', report_number: '報告書番号' }
    : {
        affiliation: 'Affiliation',
        recipient: 'Recipient',
        report_number: 'Report number',
      };
  return (
    <section
      className="space-y-3"
      aria-label={ja ? '報告書の構成' : 'Report structure'}
    >
      <h2 className="text-sm font-semibold">
        {ja ? '報告書の構成' : 'Report structure'}
      </h2>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = reportSettingsSchema.safeParse(
            storedReportSettings(settings, metadata.theme),
          );
          setError(!parsed.success);
          if (parsed.success)
            onApply({
              ...Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [
                  key,
                  value || undefined,
                ]),
              ),
              toc,
              number_sections: numberSections,
              report_settings: parsed.data,
            });
        }}
      >
        <fieldset disabled={disabled} className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.cover}
              onChange={(event) =>
                setSettings({ ...settings, cover: event.target.checked })
              }
            />
            {ja ? '表紙を付ける' : 'Include cover page'}
          </label>
          {settings.cover && (
            <div className="grid gap-2 rounded-md border p-3">
              {(Object.keys(textFields) as Array<keyof typeof fields>).map(
                (key) => (
                  <label key={key} className="grid gap-1">
                    {textFields[key]}
                    <Input
                      value={fields[key]}
                      onChange={(event) =>
                        setFields({ ...fields, [key]: event.target.value })
                      }
                    />
                  </label>
                ),
              )}
              {(
                Object.keys(coverFields) as Array<keyof typeof coverFields>
              ).map((key) => (
                <label key={key} className="grid gap-1">
                  {coverFields[key]}
                  <Input
                    value={settings[key]}
                    maxLength={key === 'report_number' ? 100 : 200}
                    onChange={(event) =>
                      setSettings({ ...settings, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="grid gap-1">
                {ja ? '表紙のレイアウト' : 'Cover layout'}
                <NativeSelect
                  value={settings.cover_layout}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      cover_layout: event.target.value as 'fields' | 'centered',
                    })
                  }
                >
                  <NativeSelectOption value="fields">
                    {ja ? '項目名付き（所属・日付など）' : 'Labelled fields'}
                  </NativeSelectOption>
                  <NativeSelectOption value="centered">
                    {ja ? '中央揃え（項目名なし）' : 'Centred, no field names'}
                  </NativeSelectOption>
                </NativeSelect>
              </label>
              <p className="text-xs text-muted-foreground">
                {ja
                  ? '空欄は表紙に表示しません。本文は表紙の後から始まります。'
                  : 'Empty fields are omitted. Body text starts after the cover.'}
              </p>
            </div>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={numberSections}
              onChange={(event) => setNumberSections(event.target.checked)}
            />
            {ja ? '章・節番号を表示' : 'Show heading numbers'}
          </label>
          <label className="grid gap-1">
            {ja ? '章・節の番号書式' : 'Heading number format'}
            <NativeSelect
              value={settings.heading_numbering}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  heading_numbering: event.target.value as
                    | 'section'
                    | 'chapter',
                })
              }
            >
              <NativeSelectOption value="section">
                {ja ? '階層番号（1、1.1）' : 'Hierarchical (1, 1.1)'}
              </NativeSelectOption>
              <NativeSelectOption value="chapter">
                {ja ? '章番号（第1章、1.1）' : 'Chapters (Chapter 1, 1.1)'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '番号を付ける見出し' : 'Numbered heading levels'}
            <NativeSelect
              value={settings.number_depth}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  number_depth: Number(event.target.value),
                })
              }
            >
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {ja ? `H${level}まで` : `Through H${level}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '付録の番号' : 'Appendix numbers'}
            <NativeSelect
              value={settings.appendix_numbering}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  appendix_numbering: event.target.value as
                    | 'auto'
                    | 'letter'
                    | 'continue',
                })
              }
            >
              <NativeSelectOption value="auto">
                {ja
                  ? '自動（章番号のときだけ付録A）'
                  : 'Automatic (letters with chapters only)'}
              </NativeSelectOption>
              <NativeSelectOption value="letter">
                {ja ? '付録A、A.1' : 'Appendix A, A.1'}
              </NativeSelectOption>
              <NativeSelectOption value="continue">
                {ja ? '本文から続けて数える' : 'Continue the body numbers'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '図・表・式の番号' : 'Figure, table and equation numbers'}
            <NativeSelect
              value={settings.caption_numbering}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  caption_numbering: event.target.value as
                    | 'continuous'
                    | 'chapter',
                })
              }
            >
              <NativeSelectOption value="continuous">
                {ja ? '文書全体の通し番号' : 'Continuous throughout document'}
              </NativeSelectOption>
              <NativeSelectOption value="chapter">
                {ja ? '章ごと（図2.1、式2.1）' : 'By chapter (Figure 2.1)'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '図表番号と表題の区切り' : 'Caption separator'}
            <NativeSelect
              value={settings.caption_separator}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  caption_separator: event.target.value,
                })
              }
            >
              {[
                ...new Set([
                  ' — ',
                  ': ',
                  '：',
                  '　',
                  settings.caption_separator,
                ]),
              ].map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {`${ja ? '図 1' : 'Figure 1'}${value}${ja ? '表題' : 'Title'}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <p className="text-xs text-muted-foreground">
            {ja
              ? 'H1見出しを章の境界にします。章名の原稿への自動挿入は行いません。'
              : 'H1 headings define chapter boundaries. Project chapter titles are not inserted into the source.'}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={toc}
              onChange={(event) => setToc(event.target.checked)}
            />
            {ja ? '見出しの目次を付ける' : 'Include table of contents'}
          </label>
          <label className="grid gap-1">
            {ja ? '目次の表題' : 'Contents title'}
            <Input
              value={settings.toc_title}
              maxLength={40}
              placeholder={ja ? '空欄はテーマの既定' : 'Empty: theme default'}
              onChange={(event) =>
                setSettings({ ...settings, toc_title: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1">
            {ja ? '目次に含める見出し' : 'Contents depth'}
            <NativeSelect
              value={settings.toc_depth}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  toc_depth: Number(event.target.value),
                })
              }
            >
              {[1, 2, 3, 4, 5, 6].map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {ja ? `H${level}まで` : `Through H${level}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {(
            [
              [
                'list_figures',
                ja ? '図目次を付ける' : 'Include list of figures',
              ],
              ['list_tables', ja ? '表目次を付ける' : 'Include list of tables'],
              [
                'toc_page',
                ja
                  ? '目次・図表目次を独立ページにする'
                  : 'Place contents on a separate page',
              ],
              [
                'toc_page_numbers',
                ja
                  ? '目次に実際のページ番号を表示'
                  : 'Show actual page numbers in contents',
              ],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) =>
                  setSettings({ ...settings, [key]: event.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            {ja
              ? settings.toc_page_numbers
                ? '目次はリンク付きで、自動改ページを反映した実際のページ番号を表示します。Wordのページ番号はWord側で更新します。'
                : '目次はリンク付きで生成し、ページ番号は表示しません。この設定を有効にすると自動改ページを反映します。Wordのページ番号はWord側で更新します。'
              : settings.toc_page_numbers
                ? 'Contents include links and actual page numbers reflecting automatic page breaks. Word page numbers are updated in Word.'
                : 'Contents include links without page numbers. Enable this setting to reflect automatic page breaks. Word page numbers are updated in Word.'}
          </p>
          {settings.toc_page_numbers && (
            <p className="text-xs text-muted-foreground">
              {ja
                ? '完成プレビュー・HTML・PDFでは、本文とページ番号が重ならないよう下余白を最低8mm確保します。保存した余白設定は変更しません。'
                : 'Preview, HTML and PDF reserve at least 8 mm at the bottom to keep page numbers clear of the text. Your saved margin setting stays unchanged.'}
            </p>
          )}
          <label className="grid gap-1">
            {ja ? 'ページ番号の書式' : 'Page number format'}
            <Input
              value={settings.page_number_format}
              maxLength={40}
              aria-describedby={`${id}-page-format`}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  page_number_format: event.target.value,
                  // The contents follow the footer unless set apart in Front Matter.
                  ...(settings.toc_page_number_format ===
                  settings.page_number_format
                    ? { toc_page_number_format: event.target.value }
                    : {}),
                })
              }
            />
          </label>
          <p id={`${id}-page-format`} className="text-xs text-muted-foreground">
            {ja
              ? '{n} がページ番号、{total} が本文の総ページ数です。例: - {n} -、{n} / {total}'
              : '{n} is the page number and {total} the number of body pages. Examples: - {n} -, {n} / {total}'}
          </p>
          <label className="grid gap-1">
            {ja ? 'ページ番号の位置' : 'Page number position'}
            <NativeSelect
              value={settings.page_number_position}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  page_number_position: event.target.value as
                    | 'bottom-right'
                    | 'bottom-center',
                })
              }
            >
              <NativeSelectOption value="bottom-right">
                {ja ? '下・右' : 'Bottom right'}
              </NativeSelectOption>
              <NativeSelectOption value="bottom-center">
                {ja ? '下・中央' : 'Bottom centre'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '目次ページのページ番号' : 'Contents page numbers'}
            <NativeSelect
              value={settings.front_matter_page_numbers}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  front_matter_page_numbers: event.target.value as
                    | 'none'
                    | 'roman',
                })
              }
            >
              <NativeSelectOption value="none">
                {ja ? '付けない' : 'None'}
              </NativeSelectOption>
              <NativeSelectOption value="roman">
                {ja ? 'ローマ数字（i、ii）' : 'Roman numerals (i, ii)'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {ja ? '表のページ分割' : 'Tables across pages'}
            <NativeSelect
              value={settings.keep_tables}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  keep_tables: event.target.value as
                    | 'never'
                    | 'auto'
                    | 'always',
                })
              }
            >
              <NativeSelectOption value="never">
                {ja ? '行の間で分ける' : 'Break between rows'}
              </NativeSelectOption>
              <NativeSelectOption value="auto">
                {ja
                  ? '短い表（半ページ以下）は分けない'
                  : 'Keep short tables (up to half a page) together'}
              </NativeSelectOption>
              <NativeSelectOption value="always">
                {ja
                  ? '1ページに収まる表は分けない'
                  : 'Keep every table that fits on a page together'}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <p className="text-xs text-muted-foreground">
            {ja
              ? 'ページ番号の位置・目次ページの番号・表の分割は、「目次に実際のページ番号を表示」を有効にした組版（プレビュー・HTML・PDF）とWordに反映します。'
              : 'Position, contents page numbers and table breaks apply to the paginated layout (preview, HTML and PDF with actual page numbers) and to Word.'}
          </p>
          <fieldset className="grid gap-2 rounded-md border p-3">
            <legend className="px-1">
              {ja ? '注記の表題' : 'Callout titles'}
            </legend>
            {calloutTypes.map((type) => (
              <label key={type} className="grid gap-1">
                {calloutLabel(type, locale, { theme: metadata.theme })}
                <Input
                  value={settings.callout_labels[type] ?? ''}
                  maxLength={40}
                  placeholder={ja ? '空欄は既定の表題' : 'Empty: default title'}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      callout_labels: {
                        ...settings.callout_labels,
                        [type]: event.target.value || undefined,
                      },
                    })
                  }
                />
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              {ja
                ? '表題を出さない場合は、Front Matterの callout_labels に空文字を指定します。'
                : 'To hide a title, set an empty string in callout_labels in the Front Matter.'}
            </p>
          </fieldset>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.word_fields}
              onChange={(event) =>
                setSettings({ ...settings, word_fields: event.target.checked })
              }
            />
            {ja
              ? 'Word出力の番号・参照・目次をフィールドにする'
              : 'Word: numbers, references and contents as fields'}
          </label>
          <p className="text-xs text-muted-foreground">
            {ja
              ? '有効にすると、Wordで図表や見出しを追加した後にフィールドを更新して番号を振り直せます。無効のときは出力時点の文字です（Word以外のソフトで開く場合向け）。'
              : 'When enabled, numbers can be refreshed in Word after adding figures or headings. When disabled they are fixed text, which suits other word processors.'}
          </p>
          {hasCssOnlyStyle(metadata) && (
            <p className="text-xs text-muted-foreground" role="note">
              {ja
                ? 'この文書にはカスタムCSS（report_style.css）があります。プレビュー・HTML・PDFに反映され、Wordには反映されません。'
                : 'This document has custom CSS (report_style.css). It applies to the preview, HTML and PDF, but not to Word.'}
            </p>
          )}
          {error && (
            <p role="alert">
              {ja
                ? '設定内容を確認してください。'
                : 'Check the report settings.'}
            </p>
          )}
          <Button type="submit" size="sm" className="w-full">
            {ja ? '報告書の構成を適用' : 'Apply report structure'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {ja
              ? '章別プロジェクトでは全章共通です。適用後にMarkdown／JSON／ZIPへ保存してください。'
              : 'Shared across project chapters. Save as Markdown, JSON or ZIP after applying.'}
          </p>
        </fieldset>
      </form>
    </section>
  );
}
