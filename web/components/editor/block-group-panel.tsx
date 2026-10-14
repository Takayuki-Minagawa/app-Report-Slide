'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  inlineText,
  type DocumentData,
  type JsonValue,
} from '@/src/document/model';
import { splitDocumentPages } from '@/src/document/semantics';
import { blockRoles, readBlockLayout } from '@/src/document/block-layout';
import { readBlockLibrary } from '@/src/document/block-library';
import { arrangementCommands, arrangementNames } from '@/src/document/arrange';
import {
  selectedGroupNodes,
  groupDocumentBlocks,
  updateBlockLayouts,
  assignBlockRegion,
  duplicateBlockGroup,
  moveBlockGroup,
  registerBlockLibraryItem,
  insertBlockLibraryItem,
  arrangeBlockFigures,
} from '@/src/document/block-groups';
import { slideRegions, type SlideRegion } from '@/src/document/slide-design';
const roleNames = {
  body: '本文',
  lead: 'リード文',
  figureLabel: '図ラベル',
  source: '出典',
  conclusion: '結論',
  note: '注記',
};
const regionNames: Record<SlideRegion, string> = {
  full: '全幅上部',
  left: '主領域',
  'right-top': '副領域上',
  'right-bottom': '副領域下',
  bottom: '全幅下部',
};
export interface BlockGroupPanelProps {
  document: DocumentData;
  currentPageIndex: number;
  selectedNodeId?: string;
  disabled: boolean;
  onFocus: (id: string) => void;
  onApply: (next: DocumentData, message: string) => void;
  onInsertionRegionChange?: (region: SlideRegion) => void;
}
export function BlockGroupPanel({
  document,
  currentPageIndex,
  disabled,
  onFocus,
  onApply,
  onInsertionRegionChange,
}: BlockGroupPanelProps) {
  const [selection, setSelection] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [region, setRegion] = useState<SlideRegion>('bottom');
  const [result, setResult] = useState('');
  const nodes = (splitDocumentPages(document)[currentPageIndex] ?? []).filter(
    (node) => !['speakerNotes', 'slideBreak', 'pageBreak'].includes(node.type),
  );
  const selected = selectedGroupNodes(document, currentPageIndex, selection);
  const locked = selected.some(
    (node) => readBlockLayout(node.attrs.blockLayout).locked,
  );
  const library = readBlockLibrary(document.metadata);
  const run = (next: DocumentData, message: string) => {
    if (next !== document) {
      onApply(next, message);
      setResult(message);
    } else setResult('対象の数、ロック、ページ内の位置を確認してください');
  };
  const ids = selected.map((node) => node.attrs.nodeId);
  return (
    <details className="rounded border p-2">
      <summary className="cursor-pointer text-sm font-semibold">
        ブロックのまとまり・再利用
      </summary>
      <fieldset
        disabled={disabled}
        className="mt-3 space-y-3"
        aria-label="ブロックグループの操作"
      >
        <p className="text-xs">
          同じページの図・表・説明をまとめて選びます。図のキャプション、注釈、出典も一緒に移動します。
        </p>
        <div className="max-h-60 space-y-1 overflow-auto">
          {nodes.map((node, index) => {
            const layout = readBlockLayout(node.attrs.blockLayout);
            const label =
              layout.name ||
              (node.type === 'figure'
                ? node.attrs.figureEdit?.name || node.attrs.alt
                : node.type === 'paragraph' || node.type === 'heading'
                  ? inlineText(node.content)
                  : node.attrs.caption) ||
              node.type;
            return (
              <div
                className="flex items-center gap-2 text-xs"
                key={node.attrs.nodeId}
              >
                <input
                  type="checkbox"
                  aria-label={`まとめて選択 ${index + 1}: ${label}`}
                  checked={ids.includes(node.attrs.nodeId)}
                  onChange={(event) =>
                    setSelection(
                      event.target.checked
                        ? [...ids, node.attrs.nodeId]
                        : ids.filter(
                            (id) =>
                              id !== node.attrs.nodeId &&
                              (!layout.groupId ||
                                readBlockLayout(
                                  nodes.find((n) => n.attrs.nodeId === id)
                                    ?.attrs.blockLayout,
                                ).groupId !== layout.groupId),
                          ),
                    )
                  }
                />
                <button
                  type="button"
                  className="truncate text-left underline"
                  aria-label={`ブロックを選択 ${index + 1}: ${label}`}
                  onClick={() => {
                    setSelection([node.attrs.nodeId]);
                    setName(layout.name ?? '');
                    onFocus(node.attrs.nodeId);
                  }}
                >
                  {index + 1}. {String(label).slice(0, 60)}
                  {layout.locked ? ' 🔒' : ''}
                  {layout.groupId ? ' (グループ)' : ''}
                </button>
              </div>
            );
          })}
        </div>
        <output className="block text-xs" aria-live="polite">
          {selected.length}ブロックを選択
        </output>
        <label className="grid gap-1 text-xs">
          要素・部品の名前
          <input
            className="h-8 rounded border px-2"
            aria-label="ブロック・部品の名前"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            disabled={!selected.length || locked}
            onClick={() =>
              run(
                updateBlockLayouts(document, currentPageIndex, ids, { name }),
                '名前を更新しました',
              )
            }
          >
            要素名を適用
          </Button>
          <Button
            size="xs"
            disabled={selected.length < 2 || locked}
            onClick={() =>
              run(
                groupDocumentBlocks(
                  document,
                  currentPageIndex,
                  ids,
                  name || 'グループ',
                ),
                'ブロックをグループ化しました',
              )
            }
          >
            ブロックをグループ化
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!selected.length || locked}
            onClick={() =>
              run(
                updateBlockLayouts(document, currentPageIndex, ids, {
                  groupId: undefined,
                }),
                'グループを解除しました',
              )
            }
          >
            ブロックのグループ解除
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={!selected.length}
            onClick={() =>
              run(
                updateBlockLayouts(document, currentPageIndex, ids, {
                  locked: !locked,
                }),
                locked
                  ? 'ロックを解除しました'
                  : '配置とグループ操作をロックしました',
              )
            }
          >
            {locked ? 'ブロックのロック解除' : 'ブロックの配置をロック'}
          </Button>
          <Button
            size="xs"
            disabled={!selected.length || locked}
            onClick={() =>
              run(
                duplicateBlockGroup(document, currentPageIndex, ids),
                '配置を保持してまとまりを複製しました',
              )
            }
          >
            まとまりを複製
          </Button>
          {([-1, 1] as const).map((direction) => (
            <Button
              key={direction}
              size="xs"
              variant="outline"
              disabled={!selected.length || locked}
              onClick={() =>
                run(
                  moveBlockGroup(document, currentPageIndex, ids, direction),
                  'まとまりの順序を変更しました',
                )
              }
            >
              {direction < 0 ? 'まとまりを前へ' : 'まとまりを後へ'}
            </Button>
          ))}
        </div>
        <label className="grid gap-1 text-xs">
          内容の役割
          <select
            aria-label="ブロックの役割"
            value={
              selected.length
                ? (readBlockLayout(selected[0].attrs.blockLayout).role ??
                  'body')
                : 'body'
            }
            disabled={!selected.length || locked}
            onChange={(event) =>
              run(
                updateBlockLayouts(document, currentPageIndex, ids, {
                  role: event.target.value as (typeof blockRoles)[number],
                }),
                '内容の役割を更新しました',
              )
            }
          >
            {blockRoles.map((role) => (
              <option key={role} value={role}>
                {roleNames[role]}
              </option>
            ))}
          </select>
        </label>
        {document.type === 'slide' && (
          <>
            <label className="grid gap-1 text-xs">
              配置先の領域
              <select
                aria-label="まとまりの配置先領域"
                value={region}
                onChange={(event) =>
                  setRegion(event.target.value as SlideRegion)
                }
              >
                {slideRegions.map((id) => (
                  <option key={id} value={id}>
                    {regionNames[id]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={!selected.length || locked}
              onClick={() =>
                run(
                  assignBlockRegion(document, currentPageIndex, ids, region),
                  'まとまりを選択した領域へ移動しました',
                )
              }
            >
              選択した領域へ移動
            </Button>
            {onInsertionRegionChange && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onInsertionRegionChange(region)}
              >
                次の図表をこの領域へ挿入
              </Button>
            )}
            <details>
              <summary className="text-xs">手動配置の図を整列</summary>
              <p className="my-1 text-xs">
                2つ以上の配置済み図を整列、3つ以上で間隔を均等にします。グループは1つと数え、ロックを保持します。
              </p>
              <div className="flex flex-wrap gap-1">
                {arrangementCommands.map((command) => (
                  <Button
                    size="xs"
                    variant="outline"
                    key={command}
                    disabled={!selected.length || locked}
                    onClick={() =>
                      run(
                        arrangeBlockFigures(
                          document,
                          currentPageIndex,
                          ids,
                          command,
                        ),
                        `${arrangementNames[command]}を適用しました`,
                      )
                    }
                  >
                    {arrangementNames[command]}
                  </Button>
                ))}
              </div>
            </details>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={
            !selected.length || !name.trim() || library.items.length >= 100
          }
          onClick={() =>
            run(
              registerBlockLibraryItem(document, currentPageIndex, ids, name),
              '素材と出典を含めて部品を登録しました',
            )
          }
        >
          選択したまとまりを部品登録
        </Button>
        <p className="text-xs">
          登録部品はこの文書のHTML・ZIPにも保存されます。原画像・原PDFと共有文献を保持します。
        </p>
        <div className="space-y-2" aria-label="登録部品一覧">
          {library.items.map((item) => (
            <div className="rounded border p-2 text-xs" key={item.id}>
              <p>
                {item.name}（{item.nodes.length}ブロック）
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Button
                  size="xs"
                  onClick={() =>
                    run(
                      insertBlockLibraryItem(document, currentPageIndex, item),
                      `部品「${item.name}」を現在のページへ追加しました`,
                    )
                  }
                  aria-label={`${item.name}: 配置を保持して追加`}
                >
                  配置を保持して追加
                </Button>
                {document.type === 'slide' && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      run(
                        insertBlockLibraryItem(
                          document,
                          currentPageIndex,
                          item,
                          region,
                        ),
                        `部品「${item.name}」を選択領域へ追加しました`,
                      )
                    }
                    aria-label={`${item.name}: 選択領域へ追加`}
                  >
                    選択領域へ追加
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`${item.name}: 部品登録を削除`}
                  onClick={() =>
                    run(
                      {
                        ...document,
                        metadata: {
                          ...document.metadata,
                          block_library: {
                            ...library,
                            items: library.items.filter(
                              (entry) => entry.id !== item.id,
                            ),
                          } as unknown as JsonValue,
                        },
                      },
                      '部品登録を削除しました',
                    )
                  }
                >
                  登録を削除
                </Button>
              </div>
            </div>
          ))}
        </div>
        <output className="block text-xs" aria-live="polite">
          {result}
        </output>
      </fieldset>
    </details>
  );
}
