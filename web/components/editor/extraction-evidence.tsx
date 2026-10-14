'use client';

/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Saved evidence can exceed its scroll frame; named regions need keyboard focus for arrow-key scrolling. */
import type { ExtractionResult } from '@/src/document/extraction';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { reviewedTableCsv } from '@/src/pdf/text-table';

/** Evidence is deliberately opened by the user, never shown as a startup prompt. */
export function ExtractionEvidence({ value }: { value: ExtractionResult }) {
  const ja = useAppPreferences().locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  return (
    <details className="rounded border p-2 text-xs">
      <summary className="cursor-pointer">
        {t('保存済みの読み取り結果', 'Saved extraction evidence')}
      </summary>
      <p className="my-2 text-muted-foreground">
        {t(
          '取り込み時の記録です。本文・表を後から編集しても、この記録は変わりません。',
          'Snapshot at import. Subsequent text/table edits do not change this evidence.',
        )}
      </p>
      <p>
        {value.method === 'ocr'
          ? `OCR (${value.language ?? ''})`
          : t('PDF文字データ', 'PDF text data')}
        {value.confidence !== undefined
          ? ` · ${t('認識スコア', 'Recognition score')} ${Math.round(value.confidence)}/100`
          : ''}
      </p>
      <details className="my-2">
        <summary>{t('読み取り原文', 'Raw recognition')}</summary>
        <section
          aria-label={t('保存済みの読み取り原文', 'Saved raw recognition')}
          tabIndex={0}
          className="max-h-48 overflow-auto whitespace-pre-wrap"
        >
          <pre className="whitespace-pre-wrap">{value.rawText}</pre>
        </section>
      </details>
      {value.mode === 'table' ? (
        <>
          <p className="my-2">
            {t(
              `確認・修正後の表：${value.rows.length}行 × ${value.rows[0]?.length ?? 0}列`,
              `Reviewed table: ${value.rows.length} rows × ${value.rows[0]?.length ?? 0} columns`,
            )}
          </p>
          <section
            aria-label={t('保存済みの表の確認', 'Review saved table')}
            tabIndex={0}
            className="my-2 max-h-60 overflow-auto"
          >
            <table
              aria-label={t(
                '保存済みの表読み取り結果',
                'Saved extracted table',
              )}
            >
              <tbody>
                {value.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td className="border p-1 align-top" key={c}>
                        <span className="whitespace-pre-wrap">{cell}</span>
                        {value.numericValues[r][c] !== null && (
                          <div className="text-muted-foreground">
                            = {value.numericValues[r][c]}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([reviewedTableCsv(value.rows, value.header)], {
                  type: 'text/csv;charset=utf-8',
                }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = 'extracted-table.csv';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t('取り込み時の表をCSV保存', 'Save imported table CSV')}
          </Button>
        </>
      ) : (
        <div className="space-y-1">
          <p>{t('確認・修正後の本文', 'Reviewed text')}</p>
          <section
            aria-label={t(
              '保存済みの確認・修正後の本文',
              'Saved reviewed text',
            )}
            tabIndex={0}
            className="max-h-48 overflow-auto whitespace-pre-wrap"
          >
            <pre className="whitespace-pre-wrap">{value.text}</pre>
          </section>
        </div>
      )}
    </details>
  );
}
