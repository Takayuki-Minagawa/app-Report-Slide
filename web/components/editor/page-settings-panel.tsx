'use client';

import { useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  defaultPageSettings,
  pageNumberFields,
  pageSettingsSchema,
  paperSizes,
  type PageSettings,
} from '@/src/document/page-settings';
import { pageSettingsMessages } from '@/src/i18n/page-settings';

export function PageSettingsPanel({
  settings,
  disabled,
  onApply,
}: {
  settings: PageSettings;
  disabled: boolean;
  onApply: (settings: PageSettings) => void;
}) {
  const { locale } = useAppPreferences();
  const copy = pageSettingsMessages[locale];
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, String(value)]),
    ),
  );
  const [error, setError] = useState(false);
  const pending = Object.entries(settings).some(
    ([key, value]) => draft[key] !== String(value),
  );
  return (
    <section aria-label={copy.title} className="space-y-3">
      <h2 className="text-sm font-semibold">{copy.title}</h2>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const result = pageSettingsSchema.safeParse({
            ...draft,
            ...Object.fromEntries(
              Object.keys(pageNumberFields).map((key) => [
                key,
                draft[key]?.trim() ? Number(draft[key]) : NaN,
              ]),
            ),
          });
          setError(!result.success);
          if (result.success) onApply(result.data);
        }}
      >
        <fieldset disabled={disabled} className="space-y-3">
          <label className="grid gap-1 text-sm">
            {copy.paper}
            <NativeSelect
              value={draft.paper}
              aria-label={copy.paper}
              onChange={(event) =>
                setDraft({ ...draft, paper: event.target.value })
              }
            >
              {Object.keys(paperSizes).map((paper) => (
                <NativeSelectOption key={paper} value={paper}>
                  {paper === 'B5' ? 'B5 (JIS)' : paper}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm">
            {copy.orientation}
            <NativeSelect
              value={draft.orientation}
              aria-label={copy.orientation}
              onChange={(event) =>
                setDraft({ ...draft, orientation: event.target.value })
              }
            >
              <NativeSelectOption value="portrait">
                {copy.portrait}
              </NativeSelectOption>
              <NativeSelectOption value="landscape">
                {copy.landscape}
              </NativeSelectOption>
            </NativeSelect>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(pageNumberFields).map(([field, bounds]) => {
              const key = field as keyof typeof pageNumberFields;
              return (
                <label key={key} className="grid gap-1 text-sm">
                  {copy[key]}
                  <Input
                    type="number"
                    required
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    aria-label={copy[key]}
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                  />
                </label>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {copy.invalid}
            </p>
          )}
          {pending && (
            <output className="block text-xs text-muted-foreground">
              {copy.pending}
            </output>
          )}
          <Button type="submit" size="sm" className="w-full">
            {copy.apply}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              setDraft(
                Object.fromEntries(
                  Object.entries(defaultPageSettings).map(([key, value]) => [
                    key,
                    String(value),
                  ]),
                ),
              );
              setError(false);
              onApply({ ...defaultPageSettings });
            }}
          >
            {copy.reset}
          </Button>
        </fieldset>
      </form>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {copy.help}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {copy.preview}
      </p>
    </section>
  );
}
