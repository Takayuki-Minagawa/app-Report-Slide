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
  noIndentAfterKinds,
  pageNumberFields,
  pageSettingsSchema,
  paperSizes,
  type NoIndentAfterKind,
  type PageSettings,
} from '@/src/document/page-settings';
import { pageSettingsMessages } from '@/src/i18n/page-settings';

/** Form fields are strings; the list-valued rule is kept in its own state. */
function scalarDraft(settings: PageSettings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => key !== 'no_indent_after')
      .map(([key, value]) => [key, String(value)]),
  );
}

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
    scalarDraft(settings),
  );
  const [noIndentAfter, setNoIndentAfter] = useState<NoIndentAfterKind[]>(
    () => settings.no_indent_after ?? [],
  );
  const [error, setError] = useState(false);
  const pending =
    Object.entries(scalarDraft(settings)).some(
      ([key, value]) => draft[key] !== value,
    ) ||
    noIndentAfterKinds.some(
      (kind) =>
        noIndentAfter.includes(kind) !==
        (settings.no_indent_after ?? []).includes(kind),
    ) ||
    (draft.after_heading_indent ?? 'same') !==
      (settings.after_heading_indent ?? 'same');
  const indent = Number(draft.first_line_indent);
  const spacing = Number(draft.paragraph_spacing);
  const afterHeading = draft.after_heading_indent ?? 'same';
  const preset =
    indent === 1 && spacing === 0
      ? afterHeading === 'none'
        ? 'heading'
        : 'japanese'
      : indent === 0 && spacing === 12
        ? 'spaced'
        : 'custom';
  const sampleIndent =
    Number.isFinite(indent) && indent >= 0 && indent <= 8 ? indent : 0;
  const sampleSpacing =
    Number.isFinite(spacing) && spacing >= 0 && spacing <= 36 ? spacing : 0;
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
            // Keep a stable, de-duplicated order so saved files do not churn.
            ...(noIndentAfter.length > 0 && {
              no_indent_after: noIndentAfterKinds.filter((kind) =>
                noIndentAfter.includes(kind),
              ),
            }),
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
          <section
            className="space-y-3 rounded-md border p-3"
            aria-label={copy.bodyFormat}
          >
            <h3 className="text-sm font-semibold">{copy.bodyFormat}</h3>
            <label className="grid gap-1 text-sm">
              {copy.preset}
              <NativeSelect
                aria-label={copy.preset}
                value={preset}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'custom') return;
                  setDraft({
                    ...draft,
                    first_line_indent: value === 'spaced' ? '0' : '1',
                    paragraph_spacing: value === 'spaced' ? '12' : '0',
                    after_heading_indent: value === 'heading' ? 'none' : 'same',
                  });
                }}
              >
                {Object.entries(copy.presets).map(([value, label]) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              {copy.afterHeading}
              <NativeSelect
                aria-label={copy.afterHeading}
                value={afterHeading}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    after_heading_indent: event.target.value,
                  })
                }
              >
                <NativeSelectOption value="same">
                  {copy.sameIndent}
                </NativeSelectOption>
                <NativeSelectOption value="none">
                  {copy.noIndent}
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <fieldset className="grid gap-1 text-sm">
              <legend>{copy.noIndentAfter}</legend>
              {noIndentAfterKinds.map((kind) => (
                <label key={kind} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={noIndentAfter.includes(kind)}
                    onChange={(event) =>
                      setNoIndentAfter(
                        event.target.checked
                          ? [...noIndentAfter, kind]
                          : noIndentAfter.filter((entry) => entry !== kind),
                      )
                    }
                  />
                  {copy.noIndentAfterKinds[kind]}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                {copy.noIndentAfterHelp}
              </p>
            </fieldset>
            <div
              className="rounded border bg-background p-3 text-xs leading-relaxed"
              aria-label={copy.sample}
            >
              <strong className="mb-2 block">{copy.sampleHeading}</strong>
              <p
                style={{
                  textIndent: `${afterHeading === 'none' ? 0 : sampleIndent}em`,
                  marginBottom: `${sampleSpacing}pt`,
                }}
              >
                {copy.sampleFirst}
              </p>
              <p style={{ textIndent: `${sampleIndent}em` }}>
                {copy.sampleNext}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{copy.presetHelp}</p>
          </section>
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
              setDraft(scalarDraft(defaultPageSettings));
              setNoIndentAfter([]);
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
