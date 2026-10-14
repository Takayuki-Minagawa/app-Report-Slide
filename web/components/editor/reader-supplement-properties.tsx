'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData, DocumentMetadata } from '@/src/document/model';
import {
  readerSupplementForPage,
  setReaderSupplement,
  unassignedReaderSupplements,
  reattachReaderSupplement,
} from '@/src/document/reader-supplement';

/** Remount with document revision + page ID so Undo and page changes refresh fields. */
function ReaderSupplementForm({
  document,
  pageIndex,
  disabled,
  onMetadata,
}: {
  document: DocumentData;
  pageIndex: number;
  disabled: boolean;
  onMetadata: (metadata: DocumentMetadata) => void;
}) {
  const current = readerSupplementForPage(document, pageIndex);
  const [title, setTitle] = useState(current?.title ?? ''),
    [text, setText] = useState(current?.text ?? ''),
    [link, setLink] = useState(current?.link ?? '');
  const ja = useAppPreferences().locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  const valid = !link || /^https?:\/\/[^\s]+$/i.test(link);
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t('読者向けの補足', 'Reader supplement')} · {pageIndex + 1}
      </summary>
      <fieldset disabled={disabled} className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          {t(
            'HTMLで「詳しい説明」から開く、読者向けの補足です。発表者ノートとは用途を分けます。編集用HTMLにはどちらも保存され、秘密情報の保護には使えません。',
            'Readers open this from Details in HTML. Its purpose differs from speaker notes. Editable HTML contains both; neither is confidential.',
          )}
        </p>
        <label className="property-field">
          {t('補足の見出し', 'Supplement heading')}
          <Input
            aria-label={t('補足の見出し', 'Supplement heading')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="property-field">
          {t('詳しい説明・研究条件', 'Details and study conditions')}
          <Textarea
            aria-label={t(
              '詳しい説明・研究条件',
              'Details and study conditions',
            )}
            className="min-h-32"
            value={text}
            maxLength={20000}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label className="property-field">
          {t('文献・PDFのURL', 'Reference or PDF URL')}
          <Input
            aria-label={t('文献・PDFのURL', 'Reference or PDF URL')}
            type="url"
            value={link}
            maxLength={2000}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        {!valid && (
          <p className="text-xs text-destructive">
            {t(
              'https:// または http:// のURLを入力してください。',
              'Enter an https:// or http:// URL.',
            )}
          </p>
        )}
        <Button
          size="sm"
          disabled={!valid || disabled}
          onClick={() =>
            onMetadata(
              setReaderSupplement(document, pageIndex, { title, text, link }),
            )
          }
        >
          {t('補足を適用', 'Apply supplement')}
        </Button>
      </fieldset>
    </details>
  );
}

export function ReaderSupplementProperties(
  props: Parameters<typeof ReaderSupplementForm>[0],
) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const current = readerSupplementForPage(props.document, props.pageIndex);
  const unassigned = unassignedReaderSupplements(props.document);
  const [message, setMessage] = useState('');
  return (
    <div className="space-y-2">
      <ReaderSupplementForm key={JSON.stringify(current)} {...props} />
      {unassigned.length > 0 && (
        <details className="rounded border border-amber-500 p-3">
          <summary className="cursor-pointer text-sm">
            {ja
              ? `未割当の補足（${unassigned.length}件・原文を保持）`
              : `Unassigned supplements (${unassigned.length}, originals retained)`}
          </summary>
          <p className="my-2 text-xs">
            {ja
              ? '所属ページの本文が削除されたため、自動で別ページへ移していません。内容を確認し、必要なページを選んで戻してください。HTML・JSON・ZIP・Markdownにも原文を保持します。'
              : 'The original page content was removed. These supplements were kept without moving them to another page. Select a destination and restore them explicitly. Every editable save retains the originals.'}
          </p>
          {unassigned.map((entry) => (
            <section
              key={entry.pageId}
              className="mb-3 space-y-2 border-t pt-2"
            >
              {[entry, ...(entry.sections ?? [])].map((section, index) => (
                <div key={index}>
                  <p className="text-sm font-medium">
                    {section.title || (ja ? '見出しなし' : 'Untitled')}
                  </p>
                  <p className="whitespace-pre-wrap text-xs">{section.text}</p>
                  {section.link && (
                    <a
                      className="text-xs underline"
                      href={section.link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {ja ? '文献を開く' : 'Open reference'}
                    </a>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                disabled={props.disabled}
                onClick={() => {
                  try {
                    props.onMetadata(
                      reattachReaderSupplement(
                        props.document,
                        entry.pageId,
                        props.pageIndex,
                      ),
                    );
                    setMessage('');
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Unable to restore supplement',
                    );
                  }
                }}
              >
                {ja
                  ? `${props.pageIndex + 1}ページへ補足を戻す`
                  : `Restore supplement to page ${props.pageIndex + 1}`}
              </Button>
            </section>
          ))}
          {message && <output className="block text-xs">{message}</output>}
        </details>
      )}
    </div>
  );
}
