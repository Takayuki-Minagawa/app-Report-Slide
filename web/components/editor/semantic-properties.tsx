'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { DocumentNode } from '@/src/document/model';
import { labelPattern } from '@/src/document/semantics';

/** Parent keys this form by node ID + attributes, resetting selection/Undo drafts safely. */
export function SemanticProperties({
  node,
  disabled,
  onApply,
}: {
  node: DocumentNode;
  disabled: boolean;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
}) {
  const id = useId();
  const [label, setLabel] = useState(node.attrs.label ?? '');
  const [caption, setCaption] = useState(node.attrs.caption ?? '');
  const [numbered, setNumbered] = useState(
    node.attrs.numbered == null ? 'auto' : String(node.attrs.numbered),
  );
  const [width, setWidth] = useState(
    String(node.type === 'figure' ? node.attrs.width : 100),
  );
  const [align, setAlign] = useState(
    node.type === 'figure' ? node.attrs.align : 'center',
  );
  const [alt, setAlt] = useState(node.type === 'figure' ? node.attrs.alt : '');
  const validLabel = !label || labelPattern.test(label);
  const validWidth =
    Number.isFinite(Number(width)) &&
    Number(width) >= 10 &&
    Number(width) <= 100;
  return (
    <fieldset disabled={disabled} className="semantic-properties space-y-3">
      <label className="property-field" htmlFor={`${id}-label`}>
        参照ラベル
        <Input
          aria-label="参照ラベル"
          id={`${id}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="fig:response"
          aria-invalid={!validLabel}
        />
      </label>
      {!validLabel && (
        <p className="text-xs text-destructive">
          英字から始まる128文字以内の英数字・:._-を指定してください。
        </p>
      )}
      {node.type !== 'heading' && (
        <label className="property-field" htmlFor={`${id}-caption`}>
          キャプション
          <Textarea
            aria-label="キャプション"
            id={`${id}-caption`}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
      )}
      <label className="property-field" htmlFor={`${id}-numbered`}>
        番号付け
        <NativeSelect
          aria-label="番号付け"
          id={`${id}-numbered`}
          value={numbered}
          onChange={(event) => setNumbered(event.target.value)}
        >
          <NativeSelectOption value="auto">自動</NativeSelectOption>
          <NativeSelectOption value="true">有効</NativeSelectOption>
          <NativeSelectOption value="false">無効</NativeSelectOption>
        </NativeSelect>
      </label>
      {node.type === 'figure' && (
        <>
          <label className="property-field" htmlFor={`${id}-width`}>
            幅（%）
            <Input
              aria-label="図の幅（%）"
              id={`${id}-width`}
              type="number"
              min="10"
              max="100"
              step="0.1"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
          <label className="property-field" htmlFor={`${id}-align`}>
            配置
            <NativeSelect
              aria-label="図の配置"
              id={`${id}-align`}
              value={align}
              onChange={(event) =>
                setAlign(event.target.value as 'left' | 'center' | 'right')
              }
            >
              {[
                ['left', '左'],
                ['center', '中央'],
                ['right', '右'],
              ].map(([value, title]) => (
                <NativeSelectOption key={value} value={value}>
                  {title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="property-field" htmlFor={`${id}-alt`}>
            代替テキスト
            <Input
              aria-label="図の代替テキスト"
              id={`${id}-alt`}
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
            />
          </label>
        </>
      )}
      <Button
        size="sm"
        className="w-full"
        disabled={
          disabled || !validLabel || (node.type === 'figure' && !validWidth)
        }
        onClick={() =>
          onApply(node.attrs.nodeId, {
            label: label || null,
            numbered: numbered === 'auto' ? null : numbered === 'true',
            ...(node.type !== 'heading' ? { caption: caption || null } : {}),
            ...(node.type === 'figure'
              ? { width: Number(width), align, alt }
              : {}),
          })
        }
      >
        属性を適用
      </Button>
      <p className="text-[10px] text-muted-foreground">
        自動ではキャプションまたはラベルのある図・表・式を採番します。見出しの自動は文書の「節番号」に従い、有効・無効は個別に優先します。
      </p>
    </fieldset>
  );
}
