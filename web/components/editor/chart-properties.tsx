'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useAppPreferences } from '@/components/app-preferences';
import type { ChartNode } from '@/src/document/model';

export function ChartProperties({
  attrs,
  nodeId,
  disabled,
  onApply,
}: {
  attrs: ChartNode['attrs'];
  nodeId: string;
  disabled: boolean;
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
  const copy = useAppPreferences().copy.chart;
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <label className="property-field">
        {copy.type}
        <NativeSelect
          value={chartType}
          onChange={(event) =>
            setChartType(event.target.value as ChartNode['attrs']['chartType'])
          }
        >
          <NativeSelectOption value="line">{copy.line}</NativeSelectOption>
          <NativeSelectOption value="scatter">
            {copy.scatter}
          </NativeSelectOption>
          <NativeSelectOption value="bar">{copy.bar}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="property-field">
        {copy.data}
        <Textarea
          aria-label={copy.dataField}
          className="min-h-28 font-mono"
          value={data}
          onChange={(event) => setData(event.target.value)}
        />
      </label>
      {!valid && <p className="text-xs text-destructive">{copy.invalid}</p>}
      {(
        [
          [copy.xAxis, xLabel, setXLabel],
          [copy.yAxis, yLabel, setYLabel],
          [copy.legend, series, setSeries],
          [copy.alternativeText, alt, setAlt],
          [copy.caption, caption, setCaption],
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
        {copy.width}
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
        {copy.update}
      </Button>
    </fieldset>
  );
}
