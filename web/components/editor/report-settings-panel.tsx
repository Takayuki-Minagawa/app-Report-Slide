'use client';

import { useState } from 'react';
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
} from '@/src/document/report-settings';

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
          const parsed = reportSettingsSchema.safeParse(settings);
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
