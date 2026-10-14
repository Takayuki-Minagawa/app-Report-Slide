'use client';
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
}: {
  conversion: SvgConversion;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>SVGを部品に分解する確認</DialogTitle>
          <DialogDescription>
            原本SVGを保持し、編集できる部品を取り出します。表示を比較してから適用してください。
          </DialogDescription>
        </DialogHeader>
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
        <p>
          編集できる部品: {conversion.editableParts} / SVGのまま保持する部品:{' '}
          {conversion.retainedParts}
        </p>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            分解をキャンセル
          </Button>
          <Button disabled={!conversion.editableParts} onClick={onApply}>
            部品への分解を適用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
