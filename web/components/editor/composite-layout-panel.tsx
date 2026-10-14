'use client';

import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { inlineText, type DocumentNode } from '@/src/document/model';
import {
  createSlideComposite,
  isManualSlideNode,
  slideRegions,
  type SlideComposite,
  type SlideRegion,
} from '@/src/document/slide-design';

export interface CompositeLayoutPanelProps {
  nodes: DocumentNode[];
  value: SlideComposite;
  onChange: (value: SlideComposite) => void;
  onFocus?: (nodeId: string) => void;
}

/** Edits the pending design only; the parent supplies before/after preview and undo. */
export function CompositeLayoutPanel({
  nodes,
  value,
  onChange,
  onFocus,
}: CompositeLayoutPanelProps) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const names: Record<SlideRegion, string> = ja
    ? {
        full: '全幅上部',
        left: value.reverseColumns ? '右側' : '左側',
        'right-top': value.reverseColumns ? '左上' : '右上',
        'right-bottom': value.reverseColumns ? '左下' : '右下',
        bottom: '全幅下部',
      }
    : {
        full: 'Full-width top',
        left: value.reverseColumns ? 'Right' : 'Left',
        'right-top': value.reverseColumns ? 'Top left' : 'Top right',
        'right-bottom': value.reverseColumns ? 'Bottom left' : 'Bottom right',
        bottom: 'Full-width bottom',
      };
  const setAssignment = (
    node: DocumentNode,
    patch: Partial<SlideComposite['assignments'][number]>,
  ) => {
    const existing = value.assignments.find(
      (entry) => entry.nodeId === node.attrs.nodeId,
    );
    const next = {
      nodeId: node.attrs.nodeId,
      nodeIndex: nodes.indexOf(node),
      region: 'bottom' as const,
      order: nodes.indexOf(node),
      ...existing,
      ...patch,
    };
    onChange({
      ...value,
      assignments: [
        ...value.assignments.filter(
          (entry) => entry.nodeId !== node.attrs.nodeId,
        ),
        next,
      ],
    });
  };
  const candidates = nodes.filter(
    (node, index) =>
      !(index === 0 && node.type === 'heading') && node.type !== 'speakerNotes',
  );
  return (
    <section
      className="space-y-3 rounded-md border p-2"
      aria-label={ja ? '複合レイアウトの領域' : 'Composite layout regions'}
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        {ja
          ? '内容を各領域へ割り当てます。新しいブロックは全幅下部に表示されます。手動配置の図は元の位置を保持します。'
          : 'Assign content to regions. New blocks appear below the columns. Manually positioned figures keep their coordinates.'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs">
          {ja ? '主領域の幅 (%)' : 'Main region width (%)'}
          <Input
            type="number"
            min="20"
            max="80"
            value={Number.isFinite(value.leftWidth) ? value.leftWidth : ''}
            onChange={(event) =>
              onChange({
                ...value,
                leftWidth:
                  event.target.value === '' ? NaN : Number(event.target.value),
              })
            }
          />
        </label>
        <label className="grid gap-1 text-xs">
          {ja ? '領域間の余白 (px)' : 'Region gap (px)'}
          <Input
            type="number"
            min="0"
            max="48"
            value={Number.isFinite(value.gap) ? value.gap : ''}
            onChange={(event) =>
              onChange({
                ...value,
                gap:
                  event.target.value === '' ? NaN : Number(event.target.value),
              })
            }
          />
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() =>
          onChange({ ...value, reverseColumns: !value.reverseColumns })
        }
      >
        {ja ? '図と説明の左右を入れ替える' : 'Swap the two columns'}
      </Button>
      <output className="block text-xs" aria-live="polite">
        {ja
          ? `主領域: ${value.reverseColumns ? '右' : '左'}、読み順: 全幅上部 → 左 → 右 → 全幅下部`
          : `Main region: ${value.reverseColumns ? 'right' : 'left'}. Reading order: top → left → right → bottom.`}
      </output>
      <div className="max-h-80 space-y-3 overflow-auto">
        {candidates.map((node, index) => {
          const assignment = value.assignments.find(
            (entry) => entry.nodeId === node.attrs.nodeId,
          );
          const rawLabel =
            node.type === 'paragraph' || node.type === 'heading'
              ? inlineText(node.content)
              : node.type === 'figure'
                ? node.attrs.alt
                : (node.attrs.caption ?? node.type);
          const label =
            assignment?.name ||
            rawLabel.slice(0, 50) ||
            `${ja ? 'ブロック' : 'Block'} ${index + 1}`;
          const manual = isManualSlideNode(node);
          const region = assignment?.region ?? 'bottom';
          const ordered = candidates
            .filter(
              (candidate) =>
                !isManualSlideNode(candidate) &&
                (value.assignments.find(
                  (entry) => entry.nodeId === candidate.attrs.nodeId,
                )?.region ?? 'bottom') === region,
            )
            .sort(
              (a, b) =>
                (value.assignments.find(
                  (entry) => entry.nodeId === a.attrs.nodeId,
                )?.order ?? nodes.indexOf(a)) -
                (value.assignments.find(
                  (entry) => entry.nodeId === b.attrs.nodeId,
                )?.order ?? nodes.indexOf(b)),
            );
          const position = ordered.indexOf(node);
          const move = (delta: number) => {
            const next = [...ordered];
            [next[position], next[position + delta]] = [
              next[position + delta],
              next[position],
            ];
            const assignments = value.assignments.filter(
              (entry) =>
                !next.some(
                  (candidate) => candidate.attrs.nodeId === entry.nodeId,
                ),
            );
            next.forEach((candidate, order) =>
              assignments.push({
                ...value.assignments.find(
                  (entry) => entry.nodeId === candidate.attrs.nodeId,
                ),
                nodeId: candidate.attrs.nodeId,
                nodeIndex: nodes.indexOf(candidate),
                region,
                order,
              }),
            );
            onChange({ ...value, assignments });
          };
          return (
            <fieldset
              key={node.attrs.nodeId}
              className="space-y-2 border-t pt-2"
              aria-label={label}
            >
              <legend className="max-w-full truncate text-xs font-medium">
                {index + 1}. {label}
              </legend>
              <label className="grid gap-1 text-xs">
                {ja ? '要素名' : 'Element name'}
                <Input
                  aria-label={`${ja ? '要素名' : 'Element name'} ${index + 1}`}
                  maxLength={120}
                  value={assignment?.name ?? ''}
                  placeholder={rawLabel.slice(0, 50)}
                  onChange={(event) =>
                    setAssignment(node, { name: event.target.value })
                  }
                />
              </label>
              {manual ? (
                <p className="text-xs text-muted-foreground">
                  {ja
                    ? '手動配置を保護中。領域へ移すには図の設定で「本文の流れに戻す」を選択してください。'
                    : 'Manual placement is protected. Return the figure to text flow in its settings before assigning a region.'}
                </p>
              ) : (
                <>
                  <label className="grid gap-1 text-xs">
                    {ja ? '配置先' : 'Destination'}
                    <NativeSelect
                      aria-label={`${ja ? '配置先' : 'Destination'} ${index + 1}`}
                      value={region}
                      onChange={(event) =>
                        setAssignment(node, {
                          region: event.target.value as SlideRegion,
                          order: 100000,
                        })
                      }
                    >
                      {slideRegions.map((id) => (
                        <NativeSelectOption key={id} value={id}>
                          {names[id]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={position < 1}
                      aria-label={`${label}: ${ja ? '領域内で上へ' : 'Move up in region'}`}
                      onClick={() => move(-1)}
                    >
                      {ja ? '上へ' : 'Up'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={position < 0 || position >= ordered.length - 1}
                      aria-label={`${label}: ${ja ? '領域内で下へ' : 'Move down in region'}`}
                      onClick={() => move(1)}
                    >
                      {ja ? '下へ' : 'Down'}
                    </Button>
                    {onFocus && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${label}: ${ja ? '本文を編集' : 'Edit content'}`}
                        onClick={() => onFocus(node.attrs.nodeId)}
                      >
                        {ja ? '本文を編集' : 'Edit content'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </fieldset>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange(createSlideComposite(nodes))}
      >
        {ja ? '領域の割り当てを初期化' : 'Reset region assignments'}
      </Button>
    </section>
  );
}
