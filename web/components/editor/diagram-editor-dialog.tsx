'use client';
import { arrangementCommands, arrangementNames } from '@/src/document/arrange';

/* oxlint-disable jsx-a11y/prefer-tag-over-role */
// SVG hit targets need vector coordinates; the same controls are available as HTML buttons in the list.
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createNodeId } from '@/src/document/model';
import {
  createDiagramConnection,
  createDiagramShape,
  diagramSchema,
  type Diagram,
  type DiagramConnection,
  type DiagramEndpoint,
  type DiagramShape,
} from '@/src/document/diagram';
import {
  arrangeDiagramSelection,
  diagramConnectionPoints,
  diagramSelectionBounds,
  duplicateDiagramSelection,
  expandedDiagramSelection,
  moveDiagramSelection,
  removeDiagramSelection,
  resizeDiagramSelection,
  stackDiagramShapes,
  nextDiagramPaintOrder,
  explicitDiagramPaintOrder,
} from '@/src/document/diagram-geometry';
import { diagramSvg } from '@/src/document/diagram-svg';
import { svgDataUrl } from '@/src/document/figure-edit';

function NumericField({
  label,
  value,
  min = 0,
  max = 100,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="property-field">
      {label}
      <input
        key={value}
        className="h-8 w-full rounded border px-2"
        type="number"
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        step="0.1"
        defaultValue={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (
            event.target.value.trim() &&
            Number.isFinite(next) &&
            next >= min &&
            next <= max
          )
            onChange(next);
          else event.target.value = String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function DiagramEditorDialog({
  diagram,
  disabled = false,
  onApply,
  triggerRef,
}: {
  diagram: Diagram;
  disabled?: boolean;
  onApply: (diagram: Diagram) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const localTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = triggerRef ?? localTriggerRef;
  return (
    <>
      <Button
        ref={returnFocus}
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        図形をドラッグして編集
      </Button>
      {open && (
        <DiagramEditor
          initial={diagram}
          returnFocus={returnFocus}
          onCancel={() => setOpen(false)}
          onApply={(value) => {
            onApply(value);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DiagramEditor({
  initial,
  onCancel,
  onApply,
  returnFocus,
}: {
  initial: Diagram;
  onCancel: () => void;
  onApply: (diagram: Diagram) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [history, setHistory] = useState<{
    past: Diagram[];
    current: Diagram;
    future: Diagram[];
  }>({ past: [], current: explicitDiagramPaintOrder(initial), future: [] });
  const [selected, setSelected] = useState<string[]>(
    initial.shapes[0] ? [initial.shapes[0].id] : [],
  );
  const [dragPreview, setDragPreview] = useState<Diagram | null>(null);
  const [status, setStatus] = useState(
    '図形を選択し、ドラッグ・矢印キー・数値入力で移動できます。',
  );
  const activeDrag = useRef<{
    initial: Diagram;
    selection: string[];
    point: { x: number; y: number };
    mode: 'move' | 'resize';
    pointerId: number;
    next: Diagram;
  } | null>(null);
  const diagram = dragPreview ?? history.current;
  const selection = expandedDiagramSelection(diagram, selected);
  const bounds = diagramSelectionBounds(diagram, selection);
  const shape =
    selected.length === 1
      ? diagram.shapes.find((item) => item.id === selected[0])
      : undefined;
  const edge =
    selected.length === 1
      ? diagram.connections.find((item) => item.id === selected[0])
      : undefined;
  const locked =
    diagram.shapes.some((item) => selection.includes(item.id) && item.locked) ||
    Boolean(edge?.locked);
  const commit = (next: Diagram, message = '図形を更新しました。') => {
    const valid = diagramSchema.safeParse(next);
    if (!valid.success) {
      setStatus('図形の数・接続先・キャンバス内の数値を確認してください。');
      return false;
    }
    setHistory((current) =>
      JSON.stringify(current.current) === JSON.stringify(next)
        ? current
        : {
            past: [...current.past, current.current].slice(-100),
            current: next,
            future: [],
          },
    );
    setStatus(message);
    return true;
  };
  const undo = () =>
    setHistory((current) =>
      current.past.length
        ? {
            past: current.past.slice(0, -1),
            current: current.past.at(-1)!,
            future: [current.current, ...current.future],
          }
        : current,
    );
  const redo = () =>
    setHistory((current) =>
      current.future.length
        ? {
            past: [...current.past, current.current],
            current: current.future[0],
            future: current.future.slice(1),
          }
        : current,
    );
  const updateShape = (changes: Partial<DiagramShape>) => {
    if (shape && !shape.locked)
      commit({
        ...diagram,
        shapes: diagram.shapes.map((item) =>
          item.id === shape.id ? { ...item, ...changes } : item,
        ),
      });
  };
  const updateEdge = (changes: Partial<DiagramConnection>) => {
    if (edge && !edge.locked)
      commit({
        ...diagram,
        connections: diagram.connections.map((item) =>
          item.id === edge.id ? { ...item, ...changes } : item,
        ),
      });
  };
  const select = (id: string, multi = false) => {
    setSelected((current) =>
      multi
        ? current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id]
        : [id],
    );
  };
  const pointerPoint = (event: PointerEvent<SVGElement>) => {
    const svg =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.currentTarget.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: (point.x * 100) / diagram.width,
      y: (point.y * 100) / diagram.height,
    };
  };
  const startDrag = (
    event: PointerEvent<SVGElement>,
    id: string,
    mode: 'move' | 'resize',
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    if (!point) return;
    const nextSelection = selected.includes(id) ? selected : [id];
    setSelected(nextSelection);
    const expanded = expandedDiagramSelection(diagram, nextSelection);
    if (
      [...diagram.shapes, ...diagram.connections].some(
        (item) => expanded.includes(item.id) && item.locked,
      )
    ) {
      setStatus(
        'ロックされた図形は移動できません。先にロックを解除してください。',
      );
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    activeDrag.current = {
      initial: history.current,
      selection: nextSelection,
      point,
      mode,
      pointerId: event.pointerId,
      next: history.current,
    };
  };
  const drag = (event: PointerEvent<SVGElement>) => {
    const active = activeDrag.current;
    const point = pointerPoint(event);
    if (!active || !point || active.pointerId !== event.pointerId) return;
    const dx = point.x - active.point.x;
    const dy = point.y - active.point.y;
    const initialBounds = diagramSelectionBounds(
      active.initial,
      expandedDiagramSelection(active.initial, active.selection),
    );
    active.next =
      active.mode === 'resize' && initialBounds
        ? resizeDiagramSelection(
            active.initial,
            active.selection,
            initialBounds.width + dx,
            initialBounds.height + dy,
          )
        : moveDiagramSelection(active.initial, active.selection, dx, dy);
    setDragPreview(active.next);
  };
  const endDrag = (event: PointerEvent<SVGElement>, cancelled = false) => {
    const active = activeDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeDrag.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled)
      commit(
        active.next,
        'ドラッグを確定しました。1回の元に戻す操作で取り消せます。',
      );
    else setStatus('ドラッグを取り消しました。');
  };
  const key = (event: KeyboardEvent<SVGElement | HTMLButtonElement>) => {
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!movement[event.key] || locked) return;
    event.preventDefault();
    const [x, y] = movement[event.key];
    const step = event.shiftKey ? 5 : 1;
    if (event.altKey && bounds)
      commit(
        resizeDiagramSelection(
          diagram,
          selected,
          bounds.width + x * step,
          bounds.height + y * step,
        ),
      );
    else commit(moveDiagramSelection(diagram, selected, x * step, y * step));
  };
  const toggleLock = () =>
    commit({
      ...diagram,
      shapes: diagram.shapes.map((item) =>
        selection.includes(item.id) ? { ...item, locked: !locked } : item,
      ),
      connections: diagram.connections.map((item) =>
        selection.includes(item.id) ? { ...item, locked: !locked } : item,
      ),
    });
  const endpoint = (name: 'start' | 'end') => {
    if (!edge) return null;
    const current = edge[name];
    const label = name === 'start' ? '線の始点' : '線の終点';
    const update = (next: DiagramEndpoint) => updateEdge({ [name]: next });
    return (
      <fieldset className="space-y-1 border p-2">
        <legend>{label}</legend>
        <label className="property-field">
          {label}の接続先
          <select
            aria-label={`${label}の接続先`}
            disabled={edge.locked}
            value={current.type === 'shape' ? current.shapeId : 'point'}
            onChange={(event) =>
              update(
                event.target.value === 'point'
                  ? { type: 'point', x: name === 'start' ? 20 : 80, y: 60 }
                  : {
                      type: 'shape',
                      shapeId: event.target.value,
                      side: 'auto',
                    },
              )
            }
          >
            <option value="point">自由な点</option>
            {diagram.shapes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || item.text || item.kind}
              </option>
            ))}
          </select>
        </label>
        {current.type === 'point' ? (
          <div className="grid grid-cols-2 gap-1">
            <NumericField
              label={`${label}X (%)`}
              value={current.x}
              disabled={edge.locked}
              onChange={(x) => update({ ...current, x })}
            />
            <NumericField
              label={`${label}Y (%)`}
              value={current.y}
              disabled={edge.locked}
              onChange={(y) => update({ ...current, y })}
            />
          </div>
        ) : (
          <label className="property-field">
            {label}の接続面
            <select
              aria-label={`${label}の接続面`}
              value={current.side}
              disabled={edge.locked}
              onChange={(event) =>
                update({
                  ...current,
                  side: event.target.value as typeof current.side,
                })
              }
            >
              {(['auto', 'top', 'right', 'bottom', 'left'] as const).map(
                (side) => (
                  <option key={side} value={side}>
                    {
                      {
                        auto: '自動',
                        top: '上',
                        right: '右',
                        bottom: '下',
                        left: '左',
                      }[side]
                    }
                  </option>
                ),
              )}
            </select>
          </label>
        )}
      </fieldset>
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="flex max-h-[95vh] flex-col sm:max-w-6xl"
        finalFocus={returnFocus}
        showCloseButton={false}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'z' &&
            !(
              event.target instanceof HTMLInputElement ||
              event.target instanceof HTMLTextAreaElement
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) redo();
            else undo();
          }
          if (event.key === 'Escape' && activeDrag.current) {
            event.preventDefault();
            activeDrag.current = null;
            setDragPreview(null);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>図形で図解を編集</DialogTitle>
          <DialogDescription>
            部品を選択して位置・大きさ・接続先を変更します。図へ適用するまで文書は変わりません。外部SVGのソース編集とは別の編集方式です。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {(['rectangle', 'ellipse', 'text'] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              disabled={diagram.shapes.length >= 200}
              onClick={() => {
                const item = createDiagramShape(
                  kind,
                  diagram.shapes.length + 1,
                );
                item.paintOrder = nextDiagramPaintOrder(diagram);
                commit({ ...diagram, shapes: [...diagram.shapes, item] });
                setSelected([item.id]);
              }}
            >
              {
                {
                  rectangle: '矩形を追加',
                  ellipse: '楕円を追加',
                  text: 'テキストを追加',
                }[kind]
              }
            </Button>
          ))}
          {(['none', 'end'] as const).map((arrow) => (
            <Button
              key={arrow}
              size="sm"
              variant="outline"
              disabled={diagram.connections.length >= 300}
              onClick={() => {
                const item = createDiagramConnection(
                  arrow,
                  diagram.connections.length + 1,
                );
                item.paintOrder = nextDiagramPaintOrder(diagram);
                commit({
                  ...diagram,
                  connections: [...diagram.connections, item],
                });
                setSelected([item.id]);
              }}
            >
              {arrow === 'none' ? '線を追加' : '矢印を追加'}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!history.past.length}
            onClick={undo}
          >
            図形の変更を元に戻す
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!history.future.length}
            onClick={redo}
          >
            図形の変更をやり直す
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-xs">
            選択図形の整列・均等配置
          </summary>
          <div className="flex flex-wrap gap-1">
            {arrangementCommands.map((command) => (
              <Button
                key={command}
                size="xs"
                variant="outline"
                disabled={
                  locked ||
                  selection.length <
                    (command === 'horizontal' || command === 'vertical' ? 3 : 2)
                }
                onClick={() =>
                  commit(
                    arrangeDiagramSelection(diagram, selection, command),
                    `${arrangementNames[command]}を適用しました`,
                  )
                }
              >
                {arrangementNames[command]}
              </Button>
            ))}
          </div>
          <p className="text-xs">
            グループは1つとして動かします。均等配置は3つ以上必要です。
          </p>
        </details>
        <div className="min-h-0 overflow-auto grid gap-3 lg:grid-cols-[170px_minmax(350px,1fr)_230px]">
          <section aria-label="図解の部品一覧" className="space-y-1">
            <p className="text-xs">一覧で複数選択できます。</p>
            {[...diagram.shapes, ...diagram.connections].map((item) => (
              <div className="flex items-center gap-1" key={item.id}>
                <input
                  type="checkbox"
                  aria-label={`${item.name || item.id}を複数選択`}
                  checked={selection.includes(item.id)}
                  onChange={() => select(item.id, true)}
                />
                <Button
                  className="justify-start overflow-hidden"
                  size="sm"
                  variant={selection.includes(item.id) ? 'secondary' : 'ghost'}
                  aria-pressed={selection.includes(item.id)}
                  onFocus={() => {
                    if (!selection.includes(item.id)) select(item.id);
                  }}
                  onClick={() => select(item.id)}
                  onKeyDown={key}
                >
                  {item.locked ? '🔒 ' : ''}
                  {item.name || item.id}
                </Button>
              </div>
            ))}
          </section>
          <div>
            <div
              className="relative border bg-white"
              style={{
                aspectRatio: `${diagram.width}/${diagram.height}`,
                touchAction: 'none',
              }}
            >
              <img
                src={svgDataUrl(diagramSvg(diagram))}
                alt="編集中の構造化図解"
                className="block w-full"
                draggable={false}
              />
              <svg
                viewBox={`0 0 ${diagram.width} ${diagram.height}`}
                className="absolute inset-0 size-full"
                role="group"
                aria-label="図形操作キャンバス"
                onPointerMove={drag}
                onPointerUp={(event) => endDrag(event)}
                onPointerCancel={(event) => endDrag(event, true)}
              >
                {diagram.connections.map((item) => {
                  const points = diagramConnectionPoints(diagram, item);
                  return (
                    <line
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`線 ${item.name}`}
                      onFocus={() => {
                        if (!selection.includes(item.id)) select(item.id);
                      }}
                      x1={(points.start.x * diagram.width) / 100}
                      y1={(points.start.y * diagram.height) / 100}
                      x2={(points.end.x * diagram.width) / 100}
                      y2={(points.end.y * diagram.height) / 100}
                      stroke={
                        selection.includes(item.id) ? '#f97316' : 'transparent'
                      }
                      strokeWidth={Math.max(12, item.strokeWidth)}
                      strokeOpacity={0.35}
                      onPointerDown={(event) =>
                        startDrag(event, item.id, 'move')
                      }
                      onClick={() => select(item.id)}
                      onKeyDown={key}
                    />
                  );
                })}
                {diagram.shapes.map((item) => (
                  <rect
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`図形 ${item.name}`}
                    onFocus={() => {
                      if (!selection.includes(item.id)) select(item.id);
                    }}
                    x={(item.x * diagram.width) / 100}
                    y={(item.y * diagram.height) / 100}
                    width={(item.width * diagram.width) / 100}
                    height={(item.height * diagram.height) / 100}
                    fill="transparent"
                    stroke={
                      selection.includes(item.id) ? '#f97316' : 'transparent'
                    }
                    strokeWidth="2"
                    onPointerDown={(event) => startDrag(event, item.id, 'move')}
                    onClick={(event) => {
                      if (event.shiftKey) select(item.id, true);
                    }}
                    onKeyDown={key}
                  />
                ))}
                {bounds && !locked && selected.length > 0 && (
                  <rect
                    role="button"
                    tabIndex={0}
                    aria-label="選択図形の右下をリサイズ"
                    x={((bounds.x + bounds.width) * diagram.width) / 100 - 6}
                    y={((bounds.y + bounds.height) * diagram.height) / 100 - 6}
                    width="12"
                    height="12"
                    fill="#f97316"
                    stroke="white"
                    onPointerDown={(event) =>
                      startDrag(event, selected[0], 'resize')
                    }
                    onKeyDown={(event) => {
                      const directions: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      };
                      const delta = directions[event.key];
                      if (delta) {
                        event.preventDefault();
                        commit(
                          resizeDiagramSelection(
                            diagram,
                            selected,
                            bounds.width + delta[0] * (event.shiftKey ? 5 : 1),
                            bounds.height + delta[1] * (event.shiftKey ? 5 : 1),
                          ),
                        );
                      }
                    }}
                  />
                )}
              </svg>
            </div>
            <p className="mt-2 text-xs">
              矢印キー: 1%移動 / Shift: 5% / Alt＋矢印:
              サイズ変更。接続線は図形の移動に追従します。Escapeでドラッグを取消。
            </p>
          </div>
          <section aria-label="選択図形の設定" className="space-y-2">
            <output className="block text-xs">
              {selection.length} 部品を選択{locked ? '（ロックあり）' : ''}
            </output>
            {(shape || edge) && (
              <label className="property-field" htmlFor="diagram-part-name">
                部品の名前
                <Input
                  id="diagram-part-name"
                  aria-label="部品の名前"
                  disabled={locked}
                  value={(shape ?? edge)!.name}
                  onChange={(event) =>
                    shape
                      ? updateShape({ name: event.target.value })
                      : updateEdge({ name: event.target.value })
                  }
                />
              </label>
            )}
            {bounds && (
              <div className="grid grid-cols-2 gap-1">
                <NumericField
                  label="図形X (%)"
                  value={bounds.x}
                  disabled={locked}
                  onChange={(value) =>
                    commit(
                      moveDiagramSelection(
                        diagram,
                        selected,
                        value - bounds.x,
                        0,
                      ),
                    )
                  }
                />
                <NumericField
                  label="図形Y (%)"
                  value={bounds.y}
                  disabled={locked}
                  onChange={(value) =>
                    commit(
                      moveDiagramSelection(
                        diagram,
                        selected,
                        0,
                        value - bounds.y,
                      ),
                    )
                  }
                />
                <NumericField
                  label="図形幅 (%)"
                  value={bounds.width}
                  min={2}
                  disabled={locked}
                  onChange={(value) =>
                    commit(
                      resizeDiagramSelection(
                        diagram,
                        selected,
                        value,
                        bounds.height,
                      ),
                    )
                  }
                />
                <NumericField
                  label="図形高さ (%)"
                  value={bounds.height}
                  min={2}
                  disabled={locked}
                  onChange={(value) =>
                    commit(
                      resizeDiagramSelection(
                        diagram,
                        selected,
                        bounds.width,
                        value,
                      ),
                    )
                  }
                />
              </div>
            )}
            {shape && (
              <>
                <label className="property-field">
                  図形のラベル
                  <textarea
                    aria-label="図形のラベル"
                    className="rounded border p-2"
                    disabled={locked}
                    rows={3}
                    value={shape.text}
                    onChange={(event) =>
                      updateShape({ text: event.target.value })
                    }
                  />
                </label>
                <label className="property-field">
                  塗り色
                  <input
                    type="color"
                    disabled={locked}
                    value={shape.fill === 'none' ? '#ffffff' : shape.fill}
                    onChange={(event) =>
                      updateShape({ fill: event.target.value })
                    }
                  />
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={shape.fill === 'none'}
                    onChange={(event) =>
                      updateShape({
                        fill: event.target.checked ? 'none' : '#dbeafe',
                      })
                    }
                  />
                  塗りなし
                </label>
                <label className="property-field">
                  線と文字の色
                  <input
                    type="color"
                    disabled={locked}
                    value={shape.stroke}
                    onChange={(event) =>
                      updateShape({ stroke: event.target.value })
                    }
                  />
                </label>
                <NumericField
                  label="図形の線幅"
                  min={0}
                  max={12}
                  value={shape.strokeWidth}
                  disabled={locked}
                  onChange={(strokeWidth) => updateShape({ strokeWidth })}
                />
                <NumericField
                  label="図形の文字サイズ"
                  min={8}
                  max={72}
                  value={shape.fontSize}
                  disabled={locked}
                  onChange={(fontSize) => updateShape({ fontSize })}
                />
              </>
            )}
            {edge && (
              <>
                <label className="property-field" htmlFor="diagram-edge-label">
                  線のラベル
                  <Input
                    id="diagram-edge-label"
                    aria-label="線のラベル"
                    disabled={locked}
                    value={edge.label}
                    onChange={(event) =>
                      updateEdge({ label: event.target.value })
                    }
                  />
                </label>
                <label className="property-field">
                  矢印の向き
                  <select
                    aria-label="矢印の向き"
                    value={edge.arrow}
                    disabled={locked}
                    onChange={(event) =>
                      updateEdge({
                        arrow: event.target.value as DiagramConnection['arrow'],
                      })
                    }
                  >
                    <option value="none">矢印なし</option>
                    <option value="end">始点→終点</option>
                    <option value="start">始点←終点</option>
                    <option value="both">両方向</option>
                  </select>
                </label>
                <label className="property-field">
                  線の色
                  <input
                    type="color"
                    disabled={locked}
                    value={edge.color}
                    onChange={(event) =>
                      updateEdge({ color: event.target.value })
                    }
                  />
                </label>
                <NumericField
                  label="接続線の線幅"
                  min={0.5}
                  max={12}
                  value={edge.strokeWidth}
                  disabled={locked}
                  onChange={(strokeWidth) => updateEdge({ strokeWidth })}
                />
                {endpoint('start')}
                {endpoint('end')}
              </>
            )}
            <div className="flex flex-wrap gap-1">
              <Button
                size="xs"
                variant="outline"
                disabled={!selected.length}
                onClick={toggleLock}
              >
                {locked ? '図形のロックを解除' : '図形をロック'}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!selected.length}
                onClick={() => {
                  const next = duplicateDiagramSelection(diagram, selected);
                  if (commit(next.diagram)) setSelected(next.selected);
                }}
              >
                部品を複製
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!selected.length || locked}
                onClick={() => {
                  commit(removeDiagramSelection(diagram, selected));
                  setSelected([]);
                }}
              >
                部品を削除
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={
                  diagram.shapes.filter((item) => selection.includes(item.id))
                    .length < 2 || locked
                }
                onClick={() => {
                  const groupId = createNodeId();
                  commit({
                    ...diagram,
                    shapes: diagram.shapes.map((item) =>
                      selection.includes(item.id) ? { ...item, groupId } : item,
                    ),
                  });
                }}
              >
                図形をグループ化
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={
                  !diagram.shapes.some(
                    (item) => selection.includes(item.id) && item.groupId,
                  ) || locked
                }
                onClick={() =>
                  commit({
                    ...diagram,
                    shapes: diagram.shapes.map((item) => {
                      if (!selection.includes(item.id)) return item;
                      const { groupId: _groupId, ...rest } = item;
                      return rest;
                    }),
                  })
                }
              >
                グループ解除
              </Button>
              {(['front', 'back'] as const).map((direction) => (
                <Button
                  key={direction}
                  size="xs"
                  variant="outline"
                  disabled={!bounds || locked}
                  onClick={() => {
                    commit(stackDiagramShapes(diagram, selection, direction));
                  }}
                >
                  {direction === 'front' ? '図形を最前面へ' : '図形を最背面へ'}
                </Button>
              ))}
            </div>
          </section>
        </div>
        <output className="text-xs" aria-live="polite">
          {status}
        </output>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            図形編集をキャンセル
          </Button>
          <Button onClick={() => onApply(history.current)}>図へ適用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
