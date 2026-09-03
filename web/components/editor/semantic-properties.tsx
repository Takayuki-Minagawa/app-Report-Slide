'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useAppPreferences } from '@/components/app-preferences';
import { labelPattern, type SemanticNode } from '@/src/document/semantics';

/** Parent keys this form by node ID + attributes, resetting selection/Undo drafts safely. */
export function SemanticProperties({
  node,
  disabled,
  onApply,
}: {
  node: SemanticNode;
  disabled: boolean;
  onApply: (nodeId: string, attrs: Record<string, unknown>) => void;
}) {
  const { copy } = useAppPreferences();
  const { semantic } = copy;
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
        {semantic.referenceLabel}
        <Input
          aria-label={semantic.referenceLabel}
          id={`${id}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="fig:response"
          aria-invalid={!validLabel}
        />
      </label>
      {!validLabel && (
        <p className="text-xs text-destructive">
          {semantic.invalidReferenceLabel}
        </p>
      )}
      {node.type !== 'heading' && (
        <label className="property-field" htmlFor={`${id}-caption`}>
          {semantic.caption}
          <Textarea
            aria-label={semantic.caption}
            id={`${id}-caption`}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
      )}
      <label className="property-field" htmlFor={`${id}-numbered`}>
        {semantic.numbering}
        <NativeSelect
          aria-label={semantic.numbering}
          id={`${id}-numbered`}
          value={numbered}
          onChange={(event) => setNumbered(event.target.value)}
        >
          <NativeSelectOption value="auto">
            {semantic.automatic}
          </NativeSelectOption>
          <NativeSelectOption value="true">
            {semantic.enabled}
          </NativeSelectOption>
          <NativeSelectOption value="false">
            {semantic.disabled}
          </NativeSelectOption>
        </NativeSelect>
      </label>
      {node.type === 'figure' && (
        <>
          <label className="property-field" htmlFor={`${id}-width`}>
            {semantic.width}
            <Input
              aria-label={semantic.figureWidth}
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
            {semantic.alignment}
            <NativeSelect
              aria-label={semantic.alignment}
              id={`${id}-align`}
              value={align}
              onChange={(event) =>
                setAlign(event.target.value as 'left' | 'center' | 'right')
              }
            >
              {[
                ['left', semantic.left],
                ['center', semantic.center],
                ['right', semantic.right],
              ].map(([value, title]) => (
                <NativeSelectOption key={value} value={value}>
                  {title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="property-field" htmlFor={`${id}-alt`}>
            {semantic.alternativeText}
            <Input
              aria-label={semantic.alternativeText}
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
        {semantic.applyAttributes}
      </Button>
      <p className="text-[10px] text-muted-foreground">
        {semantic.numberingHelp}
      </p>
    </fieldset>
  );
}
