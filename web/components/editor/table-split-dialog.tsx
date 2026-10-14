'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  tableSplitOptions,
  splitTableAcrossPages,
} from '@/src/editor/table-split';
import type { DocumentType } from '@/src/document/model';

export function TableSplitDialog({
  editor,
  nodeId,
  documentType,
  onClose,
}: {
  editor: Editor;
  nodeId: string;
  documentType: DocumentType;
  onClose: () => void;
}) {
  const ja = useAppPreferences().locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  const [initial] = useState(editor.state.doc);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    editor.on('transaction', changed);
    return () => {
      editor.off('transaction', changed);
    };
  }, [editor]);
  const options = tableSplitOptions(editor, nodeId);
  const [afterRow, setAfterRow] = useState(() => {
    const candidates =
      options?.boundaries.filter((row) => row > (options.headerRows || 0)) ??
      [];
    return (
      candidates[Math.floor(candidates.length / 2)] ??
      options?.boundaries[0] ??
      0
    );
  });
  const [repeatHeader, setRepeatHeader] = useState(
    Boolean(options?.headerRows),
  );
  const [failure, setFailure] = useState(false);
  const stale = revision > 0 && editor.state.doc !== initial;
  const allowed = Boolean(
    options?.boundaries.includes(afterRow) &&
    (!repeatHeader || (options.headerRows && afterRow > options.headerRows)),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('表を次のページへ分割', 'Split table onto next page')}
          </DialogTitle>
          <DialogDescription>
            {t(
              '行の内容・結合セル・列幅を保持して分割します。後半の表と、その後に続く本文は次のページへ移ります。表番号と参照ラベルは前半に残り、後半は番号なしの続きになります。Undoで戻せます。',
              'Split without changing row content, merged cells or column widths. The second table and following content move onto the next page. The original keeps its number and reference label; the continuation is unnumbered. Undo restores the table.',
            )}
          </DialogDescription>
        </DialogHeader>
        {options?.boundaries.length ? (
          <>
            <label className="property-field">
              {t('分割位置', 'Split position')}
              <select
                aria-label={t('分割位置', 'Split position')}
                value={afterRow}
                onChange={(event) => setAfterRow(Number(event.target.value))}
              >
                {options.boundaries.map((row) => (
                  <option key={row} value={row}>
                    {t(
                      `${row}行目の後（後半 ${options.rows - row}行）`,
                      `After row ${row} (${options.rows - row} rows remaining)`,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={repeatHeader}
                disabled={!options.headerRows}
                onChange={(event) => setRepeatHeader(event.target.checked)}
              />
              {t(
                '先頭の見出し行を後半にも繰り返す',
                'Repeat leading header rows',
              )}
            </label>
            <p className="text-xs text-muted-foreground">
              {t(
                '縦に結合されたセルを横切る位置は選べません。分割後は両ページの見た目を確認してください。',
                'Boundaries crossing merged cells cannot be selected. Check both pages after splitting.',
              )}
            </p>
          </>
        ) : (
          <p>
            {t(
              '安全に分割できる行がありません。ページ直下の表を選び、縦の結合範囲を確認してください。',
              'No safe split boundary. Select a top-level table and check vertical merges.',
            )}
          </p>
        )}
        {(failure || stale) && (
          <p role="alert">
            {t(
              '表が変更されたか分割条件が無効です。一度閉じて表を確認してください。',
              'The table changed or the split is invalid. Close and check the table.',
            )}
          </p>
        )}
        <Button
          disabled={!allowed || stale || !editor.isEditable}
          onClick={() => {
            const ok = splitTableAcrossPages(
              editor,
              nodeId,
              afterRow,
              repeatHeader,
              documentType,
            );
            if (ok) onClose();
            else setFailure(true);
          }}
        >
          {t('表を分割して改ページ', 'Split table and insert page break')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
