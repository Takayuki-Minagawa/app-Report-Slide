'use client';

import { useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  maximumFootnoteLength,
  normalizeFootnoteText,
} from '@/src/document/model';

export function FootnoteProperties({
  id,
  text,
  disabled,
  onApply,
}: {
  id: string;
  text: string;
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const { copy } = useAppPreferences();
  const [draft, setDraft] = useState(text);
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="text-[11px] font-medium text-muted-foreground"
      >
        {copy.workspace.footnoteText}
      </label>
      <Textarea
        id={id}
        className="min-h-24 text-xs"
        maxLength={maximumFootnoteLength}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="text-[10px] text-muted-foreground">
        {copy.workspace.footnoteHelp}
      </p>
      <Button
        className="w-full"
        size="sm"
        disabled={disabled || !normalizeFootnoteText(draft)}
        onClick={() => {
          const normalized = normalizeFootnoteText(draft);
          setDraft(normalized);
          onApply(normalized);
        }}
      >
        {copy.workspace.updateFootnote}
      </Button>
    </div>
  );
}
