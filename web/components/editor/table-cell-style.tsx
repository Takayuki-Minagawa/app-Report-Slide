'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { DocumentType } from '@/src/document/model';
import { applyTableCellFill } from '@/src/editor/table-cell-style';
import { Button } from '@/components/ui/button';
export function TableCellStyle({
  editor,
  documentType,
  disabled = false,
}: {
  editor: Editor;
  documentType: DocumentType;
  disabled?: boolean;
}) {
  const [color, setColor] = useState('#fef08a');
  return (
    <fieldset
      disabled={disabled}
      className="flex items-center gap-1"
      aria-label="選択セルの強調色"
    >
      <label className="text-xs">
        強調色{' '}
        <input
          aria-label="選択セルの背景色"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => applyTableCellFill(editor, color, documentType)}
      >
        セルを強調
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => applyTableCellFill(editor, null, documentType)}
      >
        セルの強調を解除
      </Button>
    </fieldset>
  );
}
