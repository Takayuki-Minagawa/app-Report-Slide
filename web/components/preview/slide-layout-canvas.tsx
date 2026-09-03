'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus } from 'lucide-react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  splitDocumentPages,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import type { DocumentData, SlideImagePlacement } from '@/src/document/model';
import type { ImageUrlResolver } from '@/src/security/resource-url';
import { imageFileAccept } from '@/src/workspace/files';
import { DocumentPage } from './document-page';

export function SlideLayoutCanvas({
  document,
  analysis,
  resolveImageUrl,
  selectedNodeId,
  locked,
  onSelectFigure,
  onPlacementChange,
  onInsertImage,
}: {
  document: DocumentData;
  analysis: DocumentAnalysis;
  resolveImageUrl: ImageUrlResolver;
  selectedNodeId?: string;
  locked: boolean;
  onSelectFigure: (nodeId: string) => void;
  onPlacementChange: (nodeId: string, placement: SlideImagePlacement) => void;
  onInsertImage: (file: File, slideIndex: number) => void;
}) {
  const { copy, locale } = useAppPreferences();
  const pages = useMemo(() => splitDocumentPages(document), [document]);
  const [pageIndex, setPageIndex] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const activePage = Math.min(pageIndex, pages.length - 1);

  const chooseImage = () => imageInput.current?.click();
  const insertImage = (file: File | undefined) => {
    if (file) onInsertImage(file, activePage);
  };

  return (
    <div className="slide-layout-editor">
      <input
        ref={imageInput}
        className="sr-only"
        type="file"
        accept={imageFileAccept}
        disabled={locked}
        onChange={(event) => {
          insertImage(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
        aria-label={copy.workspace.chooseImage}
      />
      <div
        className="slide-layout-toolbar"
        role="toolbar"
        aria-label={copy.workspace.slideLayout}
      >
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={copy.workspace.previousSlide}
            disabled={activePage === 0}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft />
          </Button>
          <NativeSelect
            size="sm"
            aria-label={copy.workspace.slidePosition}
            value={activePage}
            onChange={(event) => setPageIndex(Number(event.target.value))}
          >
            {pages.map((_, index) => (
              <NativeSelectOption key={index} value={index}>
                {copy.workspace.slidePositionValue(index + 1, pages.length)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={copy.workspace.nextSlide}
            disabled={activePage === pages.length - 1}
            onClick={() =>
              setPageIndex((current) => Math.min(pages.length - 1, current + 1))
            }
          >
            <ChevronRight />
          </Button>
        </div>
        <Button type="button" size="sm" disabled={locked} onClick={chooseImage}>
          <ImagePlus data-icon="inline-start" />
          {copy.workspace.insertImage}
        </Button>
      </div>
      <p className="slide-layout-help">{copy.workspace.slideLayoutHelp}</p>
      <div className="slide-layout-stage">
        <DocumentPage
          className="slide-layout-canvas"
          document={document}
          nodes={pages[activePage] ?? []}
          analysis={analysis}
          locale={locale}
          index={activePage}
          count={pages.length}
          resolveImageUrl={resolveImageUrl}
          figureInteraction={{
            selectedNodeId,
            onSelect: onSelectFigure,
            ...(locked ? {} : { onPlacementChange }),
          }}
        />
      </div>
    </div>
  );
}
