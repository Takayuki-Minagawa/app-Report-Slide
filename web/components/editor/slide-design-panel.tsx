'use client';

import { useMemo, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DocumentPage } from '@/components/preview/document-page';
import { documentThemes } from '@/src/document/metadata';
import {
  inlineText,
  type DocumentData,
  type DocumentMetadata,
} from '@/src/document/model';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import {
  applySlideDesign,
  getSlidePageId,
  resolveSlideDesign,
  slideDesignSchema,
  slideLayouts,
  slideDensities,
  slideTypeRoles,
  slideTypographyPresets,
  type SlideDesign,
  readSlideDesignSettings,
} from '@/src/document/slide-design';
import { slideDesignMessages } from '@/src/i18n/slide-design';
import type { ImageUrlResolver } from '@/src/security/resource-url';

interface SlideDesignPanelProps {
  document: DocumentData;
  currentPageIndex?: number;
  disabled: boolean;
  resolveImageUrl?: ImageUrlResolver;
  onApply: (metadata: DocumentMetadata) => void;
}

const roleBounds = {
  title: [20, 64],
  heading: [16, 48],
  body: [12, 36],
  table: [10, 30],
  caption: [10, 24],
} as const;

export function SlideDesignPanel(props: SlideDesignPanelProps) {
  const { locale } = useAppPreferences();
  const copy = slideDesignMessages[locale];
  const [undo, setUndo] = useState<{
    before: DocumentMetadata['slide_design'];
    after: string;
  } | null>(null);
  if (props.document.type !== 'slide') return null;
  const pages = splitDocumentPages(props.document);
  const index = Math.max(
    0,
    Math.min(props.currentPageIndex ?? 0, pages.length - 1),
  );
  const canUndo =
    undo !== null &&
    undo.after === JSON.stringify(props.document.metadata.slide_design);
  return (
    <section aria-label={copy.title} className="space-y-3">
      <h2 className="text-sm font-semibold">{copy.title}</h2>
      <SlideDesignControls
        key={`${getSlidePageId(props.document, index)}:${JSON.stringify(props.document.metadata.slide_design)}`}
        {...props}
        currentPageIndex={index}
        onApply={(metadata) => {
          setUndo({
            before: props.document.metadata.slide_design,
            after: JSON.stringify(metadata.slide_design),
          });
          props.onApply(metadata);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto w-full whitespace-normal"
        disabled={props.disabled || !canUndo}
        onClick={() => {
          if (!undo || !canUndo) return;
          const metadata = { ...props.document.metadata };
          metadata.slide_design = undo.before;
          props.onApply(metadata);
          setUndo(null);
        }}
      >
        {copy.undo}
      </Button>
    </section>
  );
}

function SlideDesignControls({
  document,
  currentPageIndex = 0,
  disabled,
  resolveImageUrl,
  onApply,
}: SlideDesignPanelProps) {
  const { locale } = useAppPreferences();
  const copy = slideDesignMessages[locale];
  const [draft, setDraft] = useState<SlideDesign>(() =>
    resolveSlideDesign(document, currentPageIndex),
  );
  const [scope, setScope] = useState<'current' | 'selected' | 'all'>('current');
  const [preserveExisting, setPreserveExisting] = useState(false);
  const pages = useMemo(() => splitDocumentPages(document), [document]);
  const [selected, setSelected] = useState(
    () => new Set([getSlidePageId(document, currentPageIndex)]),
  );
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(currentPageIndex);
  const pageIds = pages.map((_, index) => getSlidePageId(document, index));
  const scopedTargets =
    scope === 'all'
      ? pageIds
      : scope === 'current'
        ? [pageIds[currentPageIndex]]
        : pageIds.filter((id) => selected.has(id));
  const customized = new Set(
    readSlideDesignSettings(document.metadata).pages.map(
      (entry) => entry.pageId,
    ),
  );
  const targets = preserveExisting
    ? scopedTargets.filter((id) => !customized.has(id))
    : scopedTargets;
  const checked = slideDesignSchema.safeParse(draft);
  const proposed = checked.success
    ? {
        ...document,
        metadata: applySlideDesign(document, targets, checked.data),
      }
    : document;
  const analysis = useMemo(() => analyzeDocument(document), [document]);
  const pageTitle = (index: number) => {
    const heading = pages[index].find((node) => node.type === 'heading');
    return `${copy.page(index)}${heading?.type === 'heading' ? ` — ${inlineText(heading.content)}` : ''}`;
  };
  return (
    <>
      <fieldset disabled={disabled} className="space-y-3">
        <label className="grid gap-1 text-xs">
          {copy.theme}
          <NativeSelect
            aria-label={copy.theme}
            value={draft.theme}
            onChange={(event) =>
              setDraft({
                ...draft,
                theme: event.target.value as SlideDesign['theme'],
              })
            }
          >
            {documentThemes.slide.map(([id, name]) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs">
          {copy.layout}
          <NativeSelect
            aria-label={copy.layout}
            value={draft.layout}
            onChange={(event) =>
              setDraft({
                ...draft,
                layout: event.target.value as SlideDesign['layout'],
              })
            }
          >
            {slideLayouts.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {copy.layouts[id]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs">
          {copy.density}
          <NativeSelect
            aria-label={copy.density}
            value={draft.density}
            onChange={(event) => {
              const density = event.target.value as SlideDesign['density'];
              setDraft({
                ...draft,
                density,
                typography: { ...slideTypographyPresets[density] },
              });
            }}
          >
            {slideDensities.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {copy.densities[id]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <details>
          <summary className="cursor-pointer text-xs">
            {copy.typography}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {slideTypeRoles.map((role) => (
              <label key={role} className="grid gap-1 text-xs">
                {copy.role[role]} ({roleBounds[role].join('–')})
                <Input
                  type="number"
                  aria-label={copy.role[role]}
                  min={roleBounds[role][0]}
                  max={roleBounds[role][1]}
                  step="0.5"
                  value={
                    Number.isFinite(draft.typography[role])
                      ? draft.typography[role]
                      : ''
                  }
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      typography: {
                        ...draft.typography,
                        [role]:
                          event.target.value === ''
                            ? NaN
                            : Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <label className="grid gap-1 text-xs">
          {copy.scope}
          <NativeSelect
            aria-label={copy.scope}
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            {(['current', 'selected', 'all'] as const).map((id) => (
              <NativeSelectOption key={id} value={id}>
                {copy[id]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex gap-2 text-xs">
          <input
            type="checkbox"
            checked={preserveExisting}
            onChange={(event) => setPreserveExisting(event.target.checked)}
          />
          {copy.preserveExisting}
        </label>
        {scope === 'selected' && (
          <fieldset className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
            <legend className="text-xs">{copy.choosePages}</legend>
            {pages.map((_, index) => (
              <label className="flex gap-2 text-xs" key={pageIds[index]}>
                <input
                  type="checkbox"
                  checked={selected.has(pageIds[index])}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(pageIds[index]);
                    else next.delete(pageIds[index]);
                    setSelected(next);
                  }}
                />
                {pageTitle(index)}
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={() => {
            if (!checked.success) {
              setError(copy.invalid);
              return;
            }
            if (!targets.length) {
              setError(copy.empty);
              return;
            }
            setError('');
            setPreviewIndex(pageIds.indexOf(targets[0]));
            setPreview(true);
          }}
        >
          {copy.preview}
        </Button>
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {copy.help}
      </p>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-h-[94dvh] overflow-auto sm:max-w-[1100px]">
          <DialogTitle>{copy.previewTitle}</DialogTitle>
          <DialogDescription>
            {copy.selectedCount(targets.length)} · {copy.limitation}
          </DialogDescription>
          <NativeSelect
            aria-label={copy.previewPage}
            value={previewIndex}
            onChange={(event) => setPreviewIndex(Number(event.target.value))}
          >
            {pages.map(
              (_, index) =>
                targets.includes(pageIds[index]) && (
                  <NativeSelectOption key={pageIds[index]} value={index}>
                    {pageTitle(index)}
                  </NativeSelectOption>
                ),
            )}
          </NativeSelect>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { label: copy.before, value: document },
              { label: copy.after, value: proposed },
            ].map(({ label, value }) => (
              <section
                key={label}
                aria-label={label}
                className="min-w-0 space-y-2"
              >
                <h3 className="text-xs font-semibold">{label}</h3>
                <DocumentPage
                  document={value}
                  nodes={pages[previewIndex]}
                  analysis={analysis}
                  locale={locale}
                  index={previewIndex}
                  count={pages.length}
                  resolveImageUrl={resolveImageUrl}
                />
              </section>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              disabled={disabled || !checked.success || !targets.length}
              onClick={() => {
                onApply(proposed.metadata);
                setPreview(false);
              }}
            >
              {copy.apply}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
