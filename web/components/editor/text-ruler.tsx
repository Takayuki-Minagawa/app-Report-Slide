'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { Editor } from '@tiptap/react';

import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData } from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import { isTextRuler, type TextRuler } from '@/src/document/text-ruler';
import {
  applyTextRuler,
  selectedTextBlocks,
} from '@/src/editor/text-ruler-commands';

type Marker = 'firstLine' | 'left' | 'right';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

function defaultRuler(document: DocumentData, blockType: string): TextRuler {
  if (document.type !== 'report' || blockType !== 'paragraph')
    return { left: 0, right: 0, firstLine: 0 };
  const settings = resolvePageSettings(document.metadata);
  const [pageWidth] = pageDimensions(settings);
  const textWidth = pageWidth - settings.margin_left - settings.margin_right;
  const indentMillimeters =
    (settings.first_line_indent * settings.font_size * 25.4) / 72;
  return {
    left: 0,
    right: 0,
    firstLine: tenth(clamp((indentMillimeters / textWidth) * 100, 0, 100)),
  };
}

function moveMarker(
  ruler: TextRuler,
  marker: Marker,
  position: number,
): TextRuler {
  const point = tenth(clamp(position, 0, 100));
  if (marker === 'firstLine')
    return { ...ruler, firstLine: clamp(point, 0, 100 - ruler.right) };
  if (marker === 'left') {
    const left = clamp(point, 0, 85 - ruler.right);
    return {
      ...ruler,
      left,
      firstLine: tenth(
        clamp(ruler.firstLine + left - ruler.left, 0, 100 - ruler.right),
      ),
    };
  }
  const right = tenth(clamp(100 - point, 0, 85 - ruler.left));
  return {
    ...ruler,
    right,
    firstLine: clamp(ruler.firstLine, 0, 100 - right),
  };
}

interface DragState {
  marker: Marker;
  pointerId: number;
  nodeIds: string[];
  value: TextRuler;
}

export function TextRulerBar({
  editor,
  document,
  disabled = false,
}: {
  editor: Editor | null;
  document: DocumentData;
  disabled?: boolean;
}) {
  const { copy } = useAppPreferences();
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<TextRuler | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => setRevision((value) => value + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  void revision;
  const blocks = editor ? selectedTextBlocks(editor) : [];
  const active = blocks.length > 0 && !disabled;
  const ruler =
    draft ??
    (isTextRuler(blocks[0]?.ruler)
      ? blocks[0].ruler
      : defaultRuler(document, blocks[0]?.type ?? 'paragraph'));
  const settings = resolvePageSettings(document.metadata);
  const [pageWidth] = pageDimensions(settings);
  const insetStyle: CSSProperties =
    document.type === 'report'
      ? {
          paddingLeft: `${(settings.margin_left / pageWidth) * 100}%`,
          paddingRight: `${(settings.margin_right / pageWidth) * 100}%`,
        }
      : { paddingLeft: 68, paddingRight: 68 };

  const positionAt = (clientX: number) => {
    const rectangle = trackRef.current?.getBoundingClientRect();
    return rectangle?.width
      ? ((clientX - rectangle.left) / rectangle.width) * 100
      : 0;
  };

  const begin = (event: PointerEvent<HTMLInputElement>, marker: Marker) => {
    if (!editor || !active) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      marker,
      pointerId: event.pointerId,
      nodeIds: blocks.map((block) => block.nodeId),
      value: ruler,
    };
  };
  const move = (event: PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const value = moveMarker(ruler, drag.marker, positionAt(event.clientX));
    drag.value = value;
    setDraft(value);
  };
  const end = (event: PointerEvent<HTMLInputElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const value = moveMarker(
      drag.value,
      drag.marker,
      positionAt(event.clientX),
    );
    dragRef.current = null;
    setDraft(null);
    if (editor) applyTextRuler(editor, value, drag.nodeIds);
  };
  const cancel = () => {
    dragRef.current = null;
    setDraft(null);
  };

  const marker = (
    kind: Marker,
    label: string,
    position: number,
    className: string,
  ) => (
    <input
      key={kind}
      type="range"
      min={kind === 'right' ? 15 + ruler.left : 0}
      max={
        kind === 'left'
          ? 85 - ruler.right
          : kind === 'right'
            ? 100
            : 100 - ruler.right
      }
      step="0.1"
      value={tenth(position)}
      readOnly
      tabIndex={active ? 0 : -1}
      aria-label={label}
      aria-valuetext={`${tenth(position)}%`}
      aria-disabled={!active}
      className={`text-ruler-marker ${className}`}
      style={{ left: `${position}%` }}
      title={`${label}: ${tenth(position)}%`}
      onPointerDown={(event) => begin(event, kind)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (!editor || !active) return;
        const direction =
          event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        const next = moveMarker(
          ruler,
          kind,
          position + direction * (event.shiftKey ? 5 : 1),
        );
        applyTextRuler(
          editor,
          next,
          blocks.map((block) => block.nodeId),
        );
      }}
    />
  );

  return (
    <fieldset className="text-ruler" aria-label={copy.workspace.textRuler}>
      <div className="text-ruler-heading">
        <strong>{copy.workspace.textRuler}</strong>
        <span>
          {!active
            ? copy.workspace.rulerUnavailable
            : blocks.length > 1
              ? copy.workspace.rulerMulti(blocks.length)
              : copy.workspace.rulerHint}
        </span>
        <button
          type="button"
          disabled={!active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editor &&
            applyTextRuler(
              editor,
              null,
              blocks.map((block) => block.nodeId),
            )
          }
        >
          {copy.workspace.rulerReset}
        </button>
      </div>
      <div className="text-ruler-inset" style={insetStyle}>
        <div className="text-ruler-track" ref={trackRef}>
          <div
            className="text-ruler-active-range"
            aria-hidden="true"
            style={{
              left: `${ruler.left}%`,
              right: `${ruler.right}%`,
            }}
          />
          {Array.from({ length: 11 }, (_, index) => (
            <span
              key={index}
              className="text-ruler-tick"
              aria-hidden="true"
              style={{ left: `${index * 10}%` }}
            >
              {index * 10}
            </span>
          ))}
          {marker(
            'firstLine',
            copy.workspace.rulerFirstLine,
            ruler.firstLine,
            'text-ruler-marker-first',
          )}
          {marker(
            'left',
            copy.workspace.rulerLeft,
            ruler.left,
            'text-ruler-marker-left',
          )}
          {marker(
            'right',
            copy.workspace.rulerRight,
            100 - ruler.right,
            'text-ruler-marker-right',
          )}
        </div>
      </div>
    </fieldset>
  );
}
