'use client';
import { useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { diagramSvg } from '@/src/document/diagram-svg';
import { svgDataUrl } from '@/src/document/figure-edit';
import type { SvgConversion } from '@/src/document/svg-to-diagram';

export function SvgConversionDialog({
  conversion,
  onApply,
  onClose,
  returnFocus,
}: {
  conversion: SvgConversion;
  onApply: () => void;
  onClose: () => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const applying = useRef(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col sm:max-w-5xl"
        initialFocus={cancelRef}
        // Applying replaces the opener with the diagram editor button. The
        // parent focuses that new button after React has committed it.
        finalFocus={() =>
          applying.current ? false : (returnFocus?.current ?? true)
        }
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>SVGを部品に分解する確認</DialogTitle>
          <DialogDescription>
            原本SVGを保持し、編集できる部品を取り出します。表示を比較してから適用してください。
          </DialogDescription>
        </DialogHeader>
        <output aria-live="polite" className="block shrink-0">
          編集できる部品: {conversion.editableParts} / SVGのまま保持する部品:{' '}
          {conversion.retainedParts}
        </output>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            <figure>
              <figcaption>原本の安全な表示</figcaption>
              <img
                className="w-full border bg-white"
                src={svgDataUrl(conversion.previewSource)}
                alt="SVG原本のプレビュー"
              />
            </figure>
            <figure>
              <figcaption>分解後のプレビュー</figcaption>
              <img
                className="w-full border bg-white"
                src={svgDataUrl(diagramSvg(conversion.diagram))}
                alt="SVG分解後のプレビュー"
              />
            </figure>
          </div>
          {conversion.retainedParts > 0 && (
            <p className="text-sm">
              曲線・回転・複雑な装飾などは元の描画順で保持します。保持した部分はこの図形エディタでは移動・分解できません。元のSVGソースに戻して編集できます。
            </p>
          )}
          {conversion.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {conversion.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {!conversion.editableParts && (
            <output>
              編集できる基本部品が見つかりませんでした。元のSVGソースをそのまま利用してください。
            </output>
          )}
          {conversion.editableParts > 0 && (
            <p className="text-sm">
              適用後は「図形をドラッグして編集」で部品を編集できます。「SVG原本に戻す」で元の表示に戻せます。
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button ref={cancelRef} variant="outline" onClick={onClose}>
            分解をキャンセル
          </Button>
          <Button
            disabled={!conversion.editableParts}
            onClick={() => {
              applying.current = true;
              onApply();
            }}
          >
            部品への分解を適用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
