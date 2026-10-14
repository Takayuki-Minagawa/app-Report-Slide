'use client';
import { Button } from '@/components/ui/button';
import { designRoles, type RoleStyle } from '@/src/document/role-style';
import type { SlideDesign } from '@/src/document/slide-design';
const names = {
  title: 'タイトル',
  heading: '見出し',
  body: '本文',
  table: '表',
  caption: 'キャプション',
  lead: 'リード文',
  figureLabel: '図ラベル',
  source: '出典',
  conclusion: '結論',
  note: '注記',
};
export function RoleStyleControls({
  value,
  onChange,
}: {
  value: SlideDesign;
  onChange: (value: SlideDesign) => void;
}) {
  const palette = value.palette ?? {
    background: '#fffefd',
    ink: '#172f48',
    accent: '#214d7a',
    tint: '#edf3f9',
  };
  const spacing = value.spacing ?? {
    horizontal: 66,
    vertical: 44,
    gap: 14,
    lineHeight: 1.55,
  };
  return (
    <details>
      <summary className="cursor-pointer text-xs">
        役割・配色・余白のスタイル
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs">
          役割はブロック一覧から指定できます。図ラベルは構造化図解と追加注釈へ反映します。原画像・外部SVG内の文字は原本のままです。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['background', 'ink', 'accent', 'tint'] as const).map((key) => (
            <label className="grid gap-1 text-xs" key={key}>
              {
                {
                  background: '背景色',
                  ink: '本文色',
                  accent: '強調色',
                  tint: '薄い背景色',
                }[key]
              }
              <input
                type="color"
                aria-label={`ページ配色 ${key}`}
                value={palette[key]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    palette: { ...palette, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['horizontal', 'vertical', 'gap', 'lineHeight'] as const).map(
            (key) => (
              <label className="grid gap-1 text-xs" key={key}>
                {
                  {
                    horizontal: '左右余白 (px)',
                    vertical: '上余白 (px)',
                    gap: '内容間の余白 (px)',
                    lineHeight: '本文の行間',
                  }[key]
                }
                <input
                  aria-label={`ページ余白 ${key}`}
                  type="number"
                  min={key === 'lineHeight' ? 1 : 0}
                  max={
                    key === 'horizontal'
                      ? 120
                      : key === 'vertical'
                        ? 100
                        : key === 'gap'
                          ? 64
                          : 2.5
                  }
                  step={key === 'lineHeight' ? 0.05 : 1}
                  value={spacing[key]}
                  onChange={(e) => {
                    if (Number.isFinite(e.target.valueAsNumber))
                      onChange({
                        ...value,
                        spacing: { ...spacing, [key]: e.target.valueAsNumber },
                      });
                  }}
                />
              </label>
            ),
          )}
        </div>
        {designRoles.map((role) => {
          const enabled = !!value.roleStyles?.[role];
          const style: RoleStyle = value.roleStyles?.[role] ?? {
            size:
              role in value.typography
                ? value.typography[role as keyof typeof value.typography]
                : role === 'lead'
                  ? value.typography.body + 2
                  : role === 'figureLabel'
                    ? 24
                    : role === 'source'
                      ? value.typography.caption
                      : value.typography.body,
            color: palette.ink,
            lineHeight: 1.5,
            spaceBefore: 0,
            spaceAfter: 8,
          };
          const update = (patch: Partial<RoleStyle>) =>
            onChange({
              ...value,
              roleStyles: {
                ...value.roleStyles,
                [role]: { ...style, ...patch },
              },
            });
          const clear = () => {
            const styles = { ...value.roleStyles };
            delete styles[role];
            onChange({ ...value, roleStyles: styles });
          };
          return (
            <details key={role}>
              <summary className="cursor-pointer text-xs">
                {names[role]}の見た目{enabled ? '（個別設定）' : ''}
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="col-span-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`${names[role]}の個別設定を使う`}
                    checked={enabled}
                    onChange={(event) =>
                      event.target.checked ? update({}) : clear()
                    }
                  />
                  この役割の個別設定を使う
                </label>
                <label className="grid gap-1 text-xs">
                  色
                  <input
                    type="color"
                    aria-label={`${names[role]}の色`}
                    value={style.color}
                    onChange={(e) => update({ color: e.target.value })}
                  />
                </label>
                {(
                  ['size', 'lineHeight', 'spaceBefore', 'spaceAfter'] as const
                ).map((key) => (
                  <label className="grid gap-1 text-xs" key={key}>
                    {
                      {
                        size: '文字サイズ',
                        lineHeight: '行間',
                        spaceBefore: '前の余白',
                        spaceAfter: '後の余白',
                      }[key]
                    }
                    <input
                      aria-label={`${names[role]}の${key}`}
                      type="number"
                      min={key === 'size' ? 8 : key === 'lineHeight' ? 1 : 0}
                      max={
                        key === 'size' ? 72 : key === 'lineHeight' ? 2.5 : 64
                      }
                      step={key === 'lineHeight' ? 0.05 : 0.5}
                      value={style[key]}
                      onChange={(e) => {
                        if (Number.isFinite(e.target.valueAsNumber))
                          update({ [key]: e.target.valueAsNumber });
                      }}
                    />
                  </label>
                ))}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!enabled}
                  onClick={clear}
                >
                  この役割の設定を解除
                </Button>
              </div>
            </details>
          );
        })}
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            onChange({
              ...value,
              palette: undefined,
              spacing: undefined,
              roleStyles: undefined,
            })
          }
        >
          配色・余白・役割をテーマに戻す
        </Button>
      </div>
    </details>
  );
}
