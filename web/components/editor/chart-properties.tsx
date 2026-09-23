'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { ChartNode } from '@/src/document/model';
import type { AppLocale } from '@/src/i18n/messages';

export function ChartProperties({
  attrs,
  nodeId,
  disabled,
  locale,
  onApply,
}: {
  attrs: ChartNode['attrs'];
  nodeId: string;
  disabled: boolean;
  locale: AppLocale;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
}) {
  const [chartType, setChartType] = useState(attrs.chartType);
  const [data, setData] = useState(
    attrs.data
      .map((point) => `${point.label},${point.x},${point.y}`)
      .join('\n'),
  );
  const [xLabel, setXLabel] = useState(attrs.xLabel);
  const [yLabel, setYLabel] = useState(attrs.yLabel);
  const [series, setSeries] = useState(attrs.series);
  const [alt, setAlt] = useState(attrs.alt);
  const [caption, setCaption] = useState(attrs.caption ?? '');
  const [width, setWidth] = useState(String(attrs.width));
  const parsed = data
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split(',');
      return parts.length === 3
        ? { label: parts[0].trim(), x: Number(parts[1]), y: Number(parts[2]) }
        : null;
    });
  const valid =
    parsed.length > 0 &&
    parsed.length <= 200 &&
    parsed.every(
      (point) =>
        point !== null &&
        point.label.length <= 80 &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y),
    ) &&
    Number(width) >= 10 &&
    Number(width) <= 100;
  const ja = locale === 'ja';
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <label className="property-field">
        {ja ? 'グラフ種類' : 'Chart type'}
        <NativeSelect
          value={chartType}
          onChange={(event) =>
            setChartType(event.target.value as ChartNode['attrs']['chartType'])
          }
        >
          <NativeSelectOption value="line">
            {ja ? '折れ線' : 'Line'}
          </NativeSelectOption>
          <NativeSelectOption value="scatter">
            {ja ? '散布図' : 'Scatter'}
          </NativeSelectOption>
          <NativeSelectOption value="bar">
            {ja ? '棒' : 'Bar'}
          </NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="property-field">
        {ja ? 'データ（ラベル,x,y を1行ずつ）' : 'Data (label,x,y per line)'}
        <Textarea
          aria-label={ja ? 'グラフデータ' : 'Chart data'}
          className="min-h-28 font-mono"
          value={data}
          onChange={(event) => setData(event.target.value)}
        />
      </label>
      {!valid && (
        <p className="text-xs text-destructive">
          {ja
            ? '1〜200行のラベルと有限の数値、幅10〜100を入力してください。'
            : 'Enter 1–200 labels and finite numbers; width 10–100.'}
        </p>
      )}
      {(
        [
          [ja ? 'X軸' : 'X axis', xLabel, setXLabel],
          [ja ? 'Y軸' : 'Y axis', yLabel, setYLabel],
          [ja ? '凡例' : 'Legend', series, setSeries],
          [ja ? '代替テキスト' : 'Alt text', alt, setAlt],
          [ja ? 'キャプション' : 'Caption', caption, setCaption],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="property-field">
          {label}
          <Input
            value={value}
            onChange={(event) => setter(event.target.value)}
          />
        </label>
      ))}
      <label className="property-field">
        {ja ? '幅（%）' : 'Width (%)'}
        <Input
          type="number"
          min="10"
          max="100"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        />
      </label>
      <Button
        size="sm"
        className="w-full"
        disabled={!valid || disabled}
        onClick={() =>
          onApply(nodeId, {
            chartType,
            data: parsed,
            xLabel,
            yLabel,
            series,
            alt,
            caption: caption || null,
            width: Number(width),
          })
        }
      >
        {ja ? 'グラフを更新' : 'Update chart'}
      </Button>
    </fieldset>
  );
}
