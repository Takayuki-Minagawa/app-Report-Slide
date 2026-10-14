'use client';

import { useState } from 'react';
import { SharedReferenceFields } from './shared-reference-fields';
import type { FigureReference } from '@/src/document/figure-edit';
import { readBlockLayout } from '@/src/document/block-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useAppPreferences } from '@/components/app-preferences';
import type { ChartNode } from '@/src/document/model';
import {
  chartColors,
  chartDataCsv,
  chartPlotSchema,
  parseChartCsv,
  resolveChartPlot,
  type ChartPlot,
} from '@/src/document/chart';

export function ChartProperties({
  attrs,
  nodeId,
  disabled,
  onApply,
  references = [],
  onMetadataChange,
}: {
  references?: FigureReference[];
  onMetadataChange?: (metadata: Record<string, unknown>) => void;
  attrs: ChartNode['attrs'];
  nodeId: string;
  disabled: boolean;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
}) {
  const [chartType, setChartType] = useState(attrs.chartType);
  const [plot, setPlot] = useState(() => resolveChartPlot(attrs));
  const [csv, setCsv] = useState(() =>
    resolveChartPlot(attrs).series.map((series) => chartDataCsv(series.data)),
  );
  const [xLabel, setXLabel] = useState(attrs.xLabel),
    [yLabel, setYLabel] = useState(attrs.yLabel);
  const [alt, setAlt] = useState(attrs.alt),
    [caption, setCaption] = useState(attrs.caption ?? ''),
    [width, setWidth] = useState(String(attrs.width));
  const [message, setMessage] = useState('');
  const parsedResults = plot.series.map((series, i) => {
    try {
      return {
        series: { ...series, data: parseChartCsv(csv[i]) },
        valid: true,
      };
    } catch {
      return { series, valid: false };
    }
  });
  const parsed = parsedResults.map((result) => result.series);
  const valid =
    parsedResults.every((result) => result.valid) &&
    chartPlotSchema.safeParse({ ...plot, series: parsed }).success &&
    Number(width) >= 10 &&
    Number(width) <= 100;
  const preferences = useAppPreferences();
  const copy = preferences.copy.chart;
  const ja = preferences.locale === 'ja';
  const t = (j: string, e: string) => (ja ? j : e);
  const updateSeries = (
    index: number,
    update: Partial<ChartPlot['series'][number]>,
  ) =>
    setPlot({
      ...plot,
      series: plot.series.map((entry, i) =>
        i === index ? { ...entry, ...update } : entry,
      ),
    });
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <label className="property-field">
        {copy.type}
        <NativeSelect
          value={chartType}
          onChange={(event) => {
            setChartType(event.target.value as typeof chartType);
            if (event.target.value === 'bar')
              setPlot({ ...plot, xScale: 'linear' });
          }}
        >
          <NativeSelectOption value="line">{copy.line}</NativeSelectOption>
          <NativeSelectOption value="scatter">
            {copy.scatter}
          </NativeSelectOption>
          <NativeSelectOption value="bar">{copy.bar}</NativeSelectOption>
        </NativeSelect>
      </label>
      {chartType === 'bar' && (
        <label className="property-field">
          {t('棒の向き', 'Bar orientation')}
          <NativeSelect
            value={plot.orientation}
            onChange={(e) =>
              setPlot({
                ...plot,
                orientation: e.target.value as ChartPlot['orientation'],
              })
            }
          >
            <NativeSelectOption value="vertical">
              {t('縦棒', 'Vertical')}
            </NativeSelectOption>
            <NativeSelectOption value="horizontal">
              {t('横棒', 'Horizontal')}
            </NativeSelectOption>
          </NativeSelect>
        </label>
      )}
      {plot.series.map((series, index) => (
        <fieldset key={index} className="space-y-2 rounded border p-2">
          <legend>
            {t('系列', 'Series')} {index + 1}
          </legend>
          <label className="property-field">
            {t('系列名', 'Series name')}
            <Input
              aria-label={`${t('系列', 'Series')} ${index + 1} ${t('名前', 'name')}`}
              value={series.name}
              maxLength={100}
              onChange={(e) => updateSeries(index, { name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="property-field">
              {t('色', 'Color')}
              <Input
                type="color"
                aria-label={`${t('系列', 'Series')} ${index + 1} ${t('色', 'color')}`}
                value={series.color}
                onChange={(e) => updateSeries(index, { color: e.target.value })}
              />
            </label>
            <label className="property-field">
              {t('線種', 'Line style')}
              <NativeSelect
                aria-label={`${t('系列', 'Series')} ${index + 1} ${t('線種', 'line style')}`}
                value={series.dash}
                onChange={(e) =>
                  updateSeries(index, {
                    dash: e.target.value as typeof series.dash,
                  })
                }
              >
                {['solid', 'dashed', 'dotted'].map((v, i) => (
                  <NativeSelectOption key={v} value={v}>
                    {ja ? ['実線', '破線', '点線'][i] : v}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
          <label className="property-field">
            {t('マーカー', 'Marker')}
            <NativeSelect
              aria-label={`${t('系列', 'Series')} ${index + 1} ${t('マーカー', 'marker')}`}
              value={series.marker}
              onChange={(e) =>
                updateSeries(index, {
                  marker: e.target.value as typeof series.marker,
                })
              }
            >
              {['circle', 'square', 'triangle', 'none'].map((v, i) => (
                <NativeSelectOption key={v} value={v}>
                  {ja ? ['丸', '四角', '三角', 'なし'][i] : v}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="property-field">
            {copy.data}
            <Textarea
              aria-label={
                index === 0 ? copy.dataField : `${copy.dataField} ${index + 1}`
              }
              className="min-h-28 font-mono"
              value={csv[index]}
              onChange={(e) =>
                setCsv(
                  csv.map((value, i) => (i === index ? e.target.value : value)),
                )
              }
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                const data = parseChartCsv(csv[index]).map((point) => ({
                  ...point,
                  yMinus: point.yMinus ?? 0,
                  yPlus: point.yPlus ?? 0,
                }));
                setCsv(
                  csv.map((value, i) =>
                    i === index ? chartDataCsv(data) : value,
                  ),
                );
              } catch {
                setMessage(
                  t(
                    '先にデータの入力を確認してください。',
                    'Check the data before adding error columns.',
                  ),
                );
              }
            }}
          >
            {t('誤差棒の列を追加', 'Add error-bar columns')}
          </Button>
          <label className="property-field">
            {t('CSVを読み込む', 'Import CSV')}
            <Input
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              aria-label={`${t('系列', 'Series')} ${index + 1} CSV`}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  if (file.size > 100_000) throw new Error();
                  const data = parseChartCsv(await file.text());
                  setCsv((values) =>
                    values.map((value, i) =>
                      i === index ? chartDataCsv(data) : value,
                    ),
                  );
                  setMessage(
                    t(
                      '読み込みました。グラフを更新して適用してください。',
                      'Imported. Update the chart to apply.',
                    ),
                  );
                } catch {
                  setMessage(
                    t(
                      'CSVを確認してください。label,x,y の3列、または誤差のヘッダー付き7列、200行までです。',
                      'Check CSV: label,x,y or 7 columns with error headers, up to 200 rows.',
                    ),
                  );
                }
              }}
            />
          </label>
          {plot.series.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t('系列', 'Series')} ${index + 1} ${t('を削除', 'remove')}`}
              onClick={() => {
                setPlot({
                  ...plot,
                  series: plot.series.filter((_, i) => i !== index),
                });
                setCsv(csv.filter((_, i) => i !== index));
              }}
            >
              {t('この系列を削除', 'Remove series')}
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={plot.series.length >= 8}
        onClick={() => {
          setPlot({
            ...plot,
            series: [
              ...plot.series,
              {
                ...plot.series[0],
                name: `${t('系列', 'Series')} ${plot.series.length + 1}`,
                color: chartColors[plot.series.length],
              },
            ],
          });
          setCsv([...csv, csv[0]]);
        }}
      >
        {t('系列を追加', 'Add series')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t(
          '1系列200点・8系列まで。表計算の3列貼り付けもできます。横棒ではY値が棒の長さ、Y単位が横軸です。',
          'Up to 8 series, 200 points each. Paste 3 spreadsheet columns. Horizontal bars use Y values and units along the horizontal axis.',
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          '誤差棒は値からの幅を xMinus,xPlus,yMinus,yPlus に入力します（空欄は未指定、0以上）。横棒のY誤差は横向きです。棒のXは分類のため、X誤差とX対数軸は使用しません。対数の棒は軸最小値を基線とします。',
          'Error columns xMinus,xPlus,yMinus,yPlus are nonnegative distances from each value; blank means absent. Y errors follow horizontal bars. Bars use categories, so X errors and X log scale are not displayed. Log bars start at the axis minimum.',
        )}
      </p>
      <label className="property-field">
        {t('誤差棒の意味・条件', 'Error-bar meaning and conditions')}
        <Input
          aria-label={t(
            '誤差棒の意味・条件',
            'Error-bar meaning and conditions',
          )}
          maxLength={300}
          value={plot.errorDescription ?? ''}
          onChange={(e) =>
            setPlot({ ...plot, errorDescription: e.target.value })
          }
        />
      </label>
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={plot.showValues}
          onChange={(e) => setPlot({ ...plot, showValues: e.target.checked })}
        />
        {t('値ラベルを表示', 'Show value labels')}
      </label>
      {(
        [
          [copy.xAxis, xLabel, setXLabel],
          [copy.yAxis, yLabel, setYLabel],
          [copy.alternativeText, alt, setAlt],
          [copy.caption, caption, setCaption],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="property-field">
          {label}
          <Input value={value} onChange={(e) => setter(e.target.value)} />
        </label>
      ))}
      {(['x', 'y'] as const).map((axis) => (
        <fieldset key={axis} className="grid grid-cols-2 gap-2">
          <legend>
            {axis.toUpperCase()}{' '}
            {t('軸設定（空欄は自動）', 'axis (blank = auto)')}
          </legend>
          <label className="property-field col-span-2">
            {axis.toUpperCase()} {t('目盛', 'scale')}
            <NativeSelect
              aria-label={`${axis.toUpperCase()} ${t('目盛', 'scale')}`}
              value={plot[`${axis}Scale`] ?? 'linear'}
              disabled={axis === 'x' && chartType === 'bar'}
              onChange={(e) =>
                setPlot({ ...plot, [`${axis}Scale`]: e.target.value })
              }
            >
              <NativeSelectOption value="linear">
                {t('線形', 'Linear')}
              </NativeSelectOption>
              <NativeSelectOption value="log">
                {t('対数（底10・正値のみ）', 'Log (base 10, positive values)')}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="property-field col-span-2">
            {axis.toUpperCase()} {t('単位', 'unit')}
            <Input
              maxLength={80}
              value={plot[`${axis}Unit`]}
              onChange={(e) =>
                setPlot({ ...plot, [`${axis}Unit`]: e.target.value })
              }
            />
          </label>
          {(['Min', 'Max'] as const).map((bound, i) => (
            <label key={bound} className="property-field">
              {axis.toUpperCase()}{' '}
              {t(i ? '最大' : '最小', i ? 'maximum' : 'minimum')}
              <Input
                type="number"
                value={plot[`${axis}${bound}`] ?? ''}
                onChange={(e) =>
                  setPlot({
                    ...plot,
                    [`${axis}${bound}`]:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      <label className="property-field">
        {t('データの性質', 'Data nature')}
        <NativeSelect
          value={plot.nature}
          onChange={(e) =>
            setPlot({ ...plot, nature: e.target.value as ChartPlot['nature'] })
          }
        >
          {['unspecified', 'observed', 'simulated', 'schematic', 'mixed'].map(
            (v, i) => (
              <NativeSelectOption key={v} value={v}>
                {ja
                  ? [
                      '未指定',
                      '実測',
                      '解析',
                      '模式（実測値ではない）',
                      '実測・解析の比較',
                    ][i]
                  : v}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      </label>
      <SharedReferenceFields
        references={references}
        value={plot.referenceId ?? ''}
        onChange={(referenceId) => setPlot({ ...plot, referenceId })}
        onMetadataChange={onMetadataChange}
      />
      <label className="property-field">
        {t('グラフの出典', 'Chart source')}
        <Textarea
          maxLength={2000}
          value={plot.source}
          onChange={(e) => setPlot({ ...plot, source: e.target.value })}
        />
      </label>
      <label className="property-field">
        {copy.width}
        <Input
          type="number"
          min="10"
          max="100"
          value={width}
          disabled={readBlockLayout(attrs.blockLayout).locked}
          onChange={(e) => setWidth(e.target.value)}
        />
      </label>
      {!valid && (
        <p className="text-xs text-destructive">
          {copy.invalid}{' '}
          {t(
            '軸範囲、0以上の誤差幅を確認してください。対数軸は値・誤差下端・範囲に正値が必要です。',
            'Check axis bounds and nonnegative error widths. Log values, lower error endpoints and bounds must be positive.',
          )}
        </p>
      )}
      <output className="text-xs">{message}</output>
      <Button
        size="sm"
        className="w-full"
        disabled={!valid || disabled}
        onClick={() => {
          onApply(nodeId, {
            chartType,
            data: parsed[0].data,
            series: parsed[0].name,
            plot: { ...plot, series: parsed },
            xLabel,
            yLabel,
            alt,
            caption: caption || null,
            width: Number(width),
          });
          setMessage(t('グラフを更新しました。', 'Chart updated.'));
        }}
      >
        {copy.update}
      </Button>
    </fieldset>
  );
}
