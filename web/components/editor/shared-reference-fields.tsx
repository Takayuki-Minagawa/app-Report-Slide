'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAppPreferences } from '@/components/app-preferences';
import {
  figureReferenceSchema,
  type FigureReference,
} from '@/src/document/figure-edit';

const empty: FigureReference = {
  id: '',
  title: '',
  authors: '',
  year: '',
  url: '',
};
export function SharedReferenceFields({
  references,
  value,
  onChange,
  onMetadataChange,
}: {
  references: FigureReference[];
  value: string;
  onChange: (id: string) => void;
  onMetadataChange?: (metadata: Record<string, unknown>) => void;
}) {
  const ja = useAppPreferences().locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  const [draft, setDraft] = useState<FigureReference>(
    () => references.find((r) => r.id === value) ?? empty,
  );
  const [message, setMessage] = useState('');
  return (
    <div className="space-y-2">
      <label className="property-field">
        {t('共有文献の出典', 'Shared reference source')}
        <select
          aria-label={t('共有文献の出典', 'Shared reference source')}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setDraft(
              references.find((r) => r.id === event.target.value) ?? empty,
            );
          }}
        >
          <option value="">
            {t('文献なし / 新規文献', 'None / new reference')}
          </option>
          {references.map((reference) => (
            <option key={reference.id} value={reference.id}>
              {reference.id} — {reference.title}
            </option>
          ))}
          {value && !references.some((r) => r.id === value) && (
            <option value={value}>
              {value} ({t('未登録', 'missing')})
            </option>
          )}
        </select>
      </label>
      {onMetadataChange && (
        <details className="space-y-2">
          <summary>
            {t('共有文献を登録・編集', 'Add / edit shared reference')}
          </summary>
          {(['id', 'title', 'authors', 'year', 'url', 'pdfUrl'] as const).map(
            (key, index) => {
              const label = t(
                [
                  '文献ID',
                  '文献の題名',
                  '文献の著者',
                  '文献の年',
                  '文献のリンク',
                  'PDFのリンク',
                ][index],
                [
                  'Reference ID',
                  'Reference title',
                  'Reference authors',
                  'Reference year',
                  'Reference URL',
                  'PDF URL',
                ][index],
              );
              return (
                <label key={key} className="property-field">
                  {label}
                  <Input
                    aria-label={label}
                    value={draft[key] ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </label>
              );
            },
          )}
          <label className="property-field">
            {t('文献の要点・研究条件', 'Reference summary and conditions')}
            <Textarea
              aria-label={t(
                '文献の要点・研究条件',
                'Reference summary and conditions',
              )}
              maxLength={10000}
              value={draft.summary ?? ''}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t(
              '同じ文献IDを参照する全図表へ反映され、要点・リンクは読み手に公開されます。',
              'Changes apply to all figures and tables with this reference ID. Summaries and links are public to readers.',
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const result = figureReferenceSchema.safeParse(draft);
              if (
                !result.success ||
                (references.length >= 1000 &&
                  !references.some((r) => r.id === draft.id))
              ) {
                setMessage(
                  t(
                    '文献ID、http/httpsリンク、文字数、登録数（1000件まで）を確認してください。',
                    'Check reference ID, HTTP(S) URLs, lengths and the 1000-reference limit.',
                  ),
                );
                return;
              }
              onMetadataChange({
                figure_references: references.some((r) => r.id === draft.id)
                  ? references.map((r) => (r.id === draft.id ? result.data : r))
                  : [...references, result.data],
              });
              onChange(draft.id);
              setMessage(
                t(
                  '文献を保存しました。図表の更新ボタンで関連付けを適用してください。',
                  'Reference saved. Apply the table/chart update to link it.',
                ),
              );
            }}
          >
            {t('共有文献を保存', 'Save shared reference')}
          </Button>
          <output className="block text-xs">{message}</output>
        </details>
      )}
    </div>
  );
}
