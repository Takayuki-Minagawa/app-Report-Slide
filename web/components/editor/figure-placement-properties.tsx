'use client';

import { useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FigureNode, SlideImagePlacement } from '@/src/document/model';
import {
  defaultSlideImagePlacement,
  isSlideImagePlacement,
} from '@/src/document/slide-layout';

export function FigurePlacementProperties({
  node,
  disabled,
  onApply,
}: {
  node: FigureNode;
  disabled: boolean;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
}) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const initial = node.attrs.slidePlacement ?? defaultSlideImagePlacement;
  const [values, setValues] = useState(
    Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [locked, setLocked] = useState(false);
  const placement = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Number(value)]),
  ) as unknown as SlideImagePlacement;
  const valid =
    Object.values(values).every((value) => value.trim() !== '') &&
    isSlideImagePlacement(placement);
  const apply = (next: SlideImagePlacement) =>
    onApply(node.attrs.nodeId, { slidePlacement: next });
  const labels = {
    x: 'X (%)',
    y: 'Y (%)',
    width: ja ? '配置の幅 (%)' : 'Placement width (%)',
    height: ja ? '配置の高さ (%)' : 'Placement height (%)',
  };
  return (
    <fieldset disabled={disabled} className="space-y-2 rounded border p-3">
      <legend className="px-1 text-xs font-medium">
        {ja
          ? '図の配置（スライド全体に対する%）'
          : 'Figure placement (% of slide)'}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(labels) as (keyof SlideImagePlacement)[]).map((key) => (
          <label className="property-field" key={key}>
            {labels[key]}
            <Input
              type="number"
              min={key === 'x' || key === 'y' ? 0 : 5}
              max="100"
              step="0.1"
              value={values[key]}
              aria-invalid={!valid}
              onChange={(event) => {
                const value = event.target.value;
                setValues((current) => {
                  const next = { ...current, [key]: value };
                  if (
                    locked &&
                    (key === 'width' || key === 'height') &&
                    value.trim()
                  ) {
                    const other = key === 'width' ? 'height' : 'width';
                    next[other] = String(
                      Math.round(
                        ((Number(value) * initial[other]) / initial[key]) * 10,
                      ) / 10,
                    );
                  }
                  return next;
                });
              }}
            />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={locked}
          onChange={(event) => setLocked(event.target.checked)}
        />
        {ja ? '縦横比を固定' : 'Lock aspect ratio'}
      </label>
      {!valid && (
        <p className="text-xs text-destructive">
          {ja
            ? '図がスライド内に収まる数値を入力してください（幅・高さ5%以上）。'
            : 'Keep the figure inside the slide (minimum width/height 5%).'}
        </p>
      )}
      <Button
        size="sm"
        disabled={disabled || !valid}
        onClick={() => apply(placement)}
      >
        {ja ? '図の配置を適用' : 'Apply figure placement'}
      </Button>
      <div className="flex flex-wrap gap-1">
        {(['left', 'center', 'right'] as const).map((alignment) => (
          <Button
            key={alignment}
            size="xs"
            variant="outline"
            disabled={disabled || !valid}
            onClick={() =>
              apply({
                ...placement,
                x:
                  alignment === 'left'
                    ? 0
                    : alignment === 'right'
                      ? 100 - placement.width
                      : (100 - placement.width) / 2,
              })
            }
          >
            {ja
              ? {
                  left: '図を左揃え',
                  center: '図を中央揃え',
                  right: '図を右揃え',
                }[alignment]
              : `Align figure ${alignment}`}
          </Button>
        ))}
      </div>
      {node.attrs.slidePlacement && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onApply(node.attrs.nodeId, { slidePlacement: null })}
        >
          {ja ? '本文の流れに戻す' : 'Return to text flow'}
        </Button>
      )}
    </fieldset>
  );
}
