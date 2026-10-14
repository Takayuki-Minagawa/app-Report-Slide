'use client';

import { readBlockLayout } from '@/src/document/block-layout';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { useAppPreferences } from '@/components/app-preferences';
import {
  canMoveBlock,
  duplicateDocumentBlock,
  moveDocumentBlock,
} from '@/src/editor/block-commands';

export function BlockActions({
  editor,
  nodeId,
  disabled,
  onFocus,
}: {
  editor: Editor | null;
  nodeId: string;
  disabled: boolean;
  onFocus: (id: string) => void;
}) {
  const { locale } = useAppPreferences();
  const [result, setResult] = useState('');
  const ja = locale === 'ja';
  let protectedBlock = false;
  editor?.state.doc.descendants((node) => {
    if (node.attrs.nodeId === nodeId) {
      const layout = readBlockLayout(node.attrs.blockLayout);
      protectedBlock = !!(layout.groupId || layout.locked);
    }
  });
  return (
    <section
      aria-label={ja ? 'ブロックの移動と複製' : 'Move and duplicate block'}
      className="space-y-2"
    >
      <p className="text-[11px] text-muted-foreground">
        {protectedBlock
          ? ja
            ? 'この要素はグループまたは配置ロックの対象です。「ブロックのまとまり・再利用」で操作してください。'
            : 'Use the block group controls for this grouped or locked element.'
          : ja
            ? '表のセルを選択している場合は、表全体を操作します。本文の順序を変更し、Undoで戻せます。'
            : 'Selecting a table cell operates on the whole table. Flow order changes can be undone.'}
      </p>
      <div className="flex flex-wrap gap-1">
        {([-1, 1] as const).map((direction) => (
          <Button
            key={direction}
            size="sm"
            variant="outline"
            disabled={
              disabled || !editor || !canMoveBlock(editor, nodeId, direction)
            }
            onClick={() => {
              if (editor && moveDocumentBlock(editor, nodeId, direction)) {
                onFocus(nodeId);
                setResult(
                  ja
                    ? 'ページ内の順序を変更しました'
                    : 'Order changed within this page',
                );
              }
            }}
          >
            {direction < 0
              ? ja
                ? 'ブロックを前へ'
                : 'Move block earlier'
              : ja
                ? 'ブロックを後へ'
                : 'Move block later'}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !editor || protectedBlock}
          onClick={() => {
            if (!editor) return;
            const copiedId = duplicateDocumentBlock(editor, nodeId);
            if (copiedId) {
              onFocus(copiedId);
              setResult(
                ja
                  ? 'ブロックを複製しました。領域への割り当ては配置設定で確認してください。'
                  : 'Block duplicated. Check its region assignment in layout settings.',
              );
            }
          }}
        >
          {ja ? 'ブロックを複製' : 'Duplicate block'}
        </Button>
      </div>
      <output className="block text-xs" aria-live="polite">
        {result}
      </output>
    </section>
  );
}
