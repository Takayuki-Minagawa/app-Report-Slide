'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DocumentPage } from '@/components/preview/document-page';
import type { DocumentData } from '@/src/document/model';
import { readFigureEdit } from '@/src/document/figure-edit';
import {
  walkDocumentTree,
  type DocumentTreeNode,
} from '@/src/document/traversal';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { slideNavigationPages } from '@/src/document/slide-navigation';
import {
  checkSlideGeometry,
  rasterPixelRatio,
  slideCheckSuggestions,
  type SlideCheckElement,
  type SlideCheckIssue,
  type SlideCheckRect,
} from '@/src/document/slide-check';
import type { ImageUrlResolver } from '@/src/security/resource-url';
import type { AppLocale } from '@/src/i18n/messages';

const referenceWidth = 920;
const referenceHeight = (referenceWidth * 9) / 16;

function rectangle(element: Element): SlideCheckRect {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

function measurable(element: Element): boolean {
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    !element.closest('.katex-mathml, .sr-only')
  );
}

function clipped(element: Element): boolean {
  const style = getComputedStyle(element);
  const clips = (value: string) => /^(auto|scroll|hidden|clip)$/.test(value);
  return (
    (clips(style.overflowX || style.overflow) &&
      element.scrollWidth > element.clientWidth + 2) ||
    (clips(style.overflowY || style.overflow) &&
      element.scrollHeight > element.clientHeight + 2)
  );
}

/** Only direct text children contribute font sizes; mathematical glyphs are excluded. */
function renderedFontSize(element: Element): number | undefined {
  if (
    element.closest('.katex') ||
    !Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    )
  )
    return undefined;
  const value = Number.parseFloat(getComputedStyle(element).fontSize);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (
    typeof SVGGraphicsElement !== 'undefined' &&
    element instanceof SVGGraphicsElement &&
    typeof element.getScreenCTM === 'function'
  ) {
    const transform = element.getScreenCTM();
    if (transform) return value * Math.hypot(transform.a, transform.b);
  }
  return value;
}

function measureElement(
  element: HTMLElement,
  name: string,
  identity?: { nodeId: string; focusNodeId?: string },
): SlideCheckElement {
  const rect = rectangle(element);
  const descendants = [element, ...element.querySelectorAll('*')].filter(
    measurable,
  );
  const contentRect = { ...rect };
  const sizes: number[] = [];
  for (const descendant of descendants) {
    const bounds = rectangle(descendant);
    if (bounds.right > bounds.left && bounds.bottom > bounds.top) {
      contentRect.left = Math.min(contentRect.left, bounds.left);
      contentRect.top = Math.min(contentRect.top, bounds.top);
      contentRect.right = Math.max(contentRect.right, bounds.right);
      contentRect.bottom = Math.max(contentRect.bottom, bounds.bottom);
    }
    const size = renderedFontSize(descendant);
    if (size !== undefined) sizes.push(size);
  }
  const ancestorNodeIds: string[] = [];
  let parent = element.parentElement;
  while (parent) {
    if (parent.dataset.nodeId) ancestorNodeIds.push(parent.dataset.nodeId);
    parent = parent.parentElement;
  }
  return {
    nodeId: identity?.nodeId ?? element.dataset.nodeId!,
    focusNodeId: identity?.focusNodeId,
    name,
    rect,
    contentRect,
    ancestorNodeIds,
    smallestFontSize: sizes.length > 0 ? Math.min(...sizes) : undefined,
    clipped: descendants.some(clipped),
  };
}

/** Mirrors audience footnote order while retaining the nearest editable source. */
function footnoteSourceTargets(
  nodes: readonly DocumentTreeNode[],
  targets: ReadonlyMap<string, string>,
  parentId?: string,
): Array<string | undefined> {
  const result: Array<string | undefined> = [];
  for (const node of nodes) {
    if (node.type === 'speakerNotes') continue;
    const nodeId =
      'attrs' in node &&
      'nodeId' in node.attrs &&
      typeof node.attrs.nodeId === 'string' &&
      targets.has(node.attrs.nodeId)
        ? node.attrs.nodeId
        : parentId;
    if (node.type === 'footnote') result.push(nodeId);
    else if ('content' in node && node.content)
      result.push(...footnoteSourceTargets(node.content, targets, nodeId));
  }
  return result;
}

async function waitForLayout(stage: HTMLElement): Promise<void> {
  const fonts = window.document.fonts?.ready;
  if (fonts) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      fonts,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1800);
      }),
    ]);
    clearTimeout(timer);
  }
  await Promise.all(
    Array.from(stage.querySelectorAll('img')).map((image) => {
      image.loading = 'eager';
      if (image.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          image.removeEventListener('load', finish);
          image.removeEventListener('error', finish);
          resolve();
        };
        const timer = setTimeout(finish, 1800);
        image.addEventListener('load', finish);
        image.addEventListener('error', finish);
      });
    }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

interface CheckRun {
  source: DocumentData;
  index: number;
  minimum: number;
  issues: SlideCheckIssue[];
}

interface CheckResult {
  source: DocumentData;
  issues: SlideCheckIssue[];
  count: number;
  minimum: number;
}

function issueText(
  issue: SlideCheckIssue,
  locale: AppLocale,
): { reason: string; suggestion: string } {
  const ja = locale === 'ja';
  switch (issue.kind) {
    case 'overflow':
      return {
        reason: ja
          ? '表示領域からのはみ出し・隠れた内容'
          : 'Content extends outside the page or is clipped',
        suggestion: ja
          ? '配置・図の大きさ・余白を調整するか、内容を次のページへ分割してください。'
          : 'Adjust placement, image size or spacing, or split content onto another page.',
      };
    case 'overlap':
      return {
        reason: ja
          ? `${issue.otherName}との重なり（要確認）`
          : `Possible overlap with ${issue.otherName}`,
        suggestion: ja
          ? 'ブロックを移動するか配置を変更してください。意図した重なりは除外できます。'
          : 'Move the blocks or change the layout. Intentional overlaps can be excluded.',
      };
    case 'footer-overlap':
      return {
        reason: ja
          ? 'フッターとの重なり（要確認）'
          : 'Possible overlap with footer',
        suggestion: ja
          ? '図表・本文の位置や高さを調整してください。'
          : 'Adjust the position or height of the figure or text.',
      };
    case 'small-text':
      return {
        reason: ja
          ? `小さい文字（約${issue.fontSize?.toFixed(1)} px）`
          : `Small text (about ${issue.fontSize?.toFixed(1)} px)`,
        suggestion: ja
          ? '文字サイズを上げ、収まらない場合は配置変更やページ分割を検討してください。'
          : 'Increase the font size; change layout or split the page if needed.',
      };
    case 'image-unavailable':
      return {
        reason: ja
          ? '画像を読み込めないため要確認'
          : 'Image could not be loaded; review required',
        suggestion: ja
          ? '画像を取り込み直すか、外部画像への接続を確認して再検査してください。'
          : 'Import the image again or check the external image connection, then rerun the check.',
      };
    case 'image-low-resolution':
      return {
        reason: ja
          ? `表示寸法に対して元画像の画素数が少ない可能性（約${issue.pixelRatio?.toFixed(2)}倍）`
          : `The original may have too few pixels for this size (about ${issue.pixelRatio?.toFixed(2)}×)`,
        suggestion: ja
          ? '基準幅920 pxでの目安です。画像内の文字が読めることを保証する検査ではありません。'
          : 'This is a hint at the 920 px reference width; it does not guarantee legible text inside images.',
      };
    case 'measurement-unavailable':
      return {
        reason: ja
          ? 'レイアウトを計測できませんでした'
          : 'Layout could not be measured',
        suggestion: ja
          ? '画面の読み込み後に再検査してください。'
          : 'Wait for the page to load, then run the check again.',
      };
  }
}

export interface SlideCheckPanelProps {
  document: DocumentData;
  resolveImageUrl?: ImageUrlResolver;
  onFocus: (nodeId: string) => void;
  onPageSelect?: (index: number) => void;
  disabled?: boolean;
}

/** Opens on request and renders one reference-size page at a time only while checking. */
export function SlideCheckPanel({
  document,
  resolveImageUrl,
  onFocus,
  onPageSelect,
  disabled,
}: SlideCheckPanelProps) {
  const { locale } = useAppPreferences();
  const ja = locale === 'ja';
  const [open, setOpen] = useState(false);
  const [minimum, setMinimum] = useState('12');
  const [run, setRun] = useState<CheckRun | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [failure, setFailure] = useState(false);
  const [excluded, setExcluded] = useState<{
    source: DocumentData;
    ids: ReadonlySet<string>;
  } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => splitDocumentPages(document), [document]);
  const navigation = useMemo(
    () => slideNavigationPages(document, locale),
    [document, locale],
  );
  const analysis = useMemo(() => analyzeDocument(document), [document]);
  const validMinimum =
    Number.isFinite(Number(minimum)) &&
    Number(minimum) >= 8 &&
    Number(minimum) <= 28;
  const staleDocument = result !== null && result.source !== document;
  const staleMinimum = result !== null && result.minimum !== Number(minimum);
  const stale = staleDocument || staleMinimum;
  const excludedIds =
    excluded?.source === document ? excluded.ids : new Set<string>();
  const issues = (stale ? [] : (result?.issues ?? [])).filter(
    (issue) => !excludedIds.has(issue.id),
  );

  useEffect(() => {
    if (!run || !open) return;
    let cancelled = false;
    const measure = async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (run.source !== document) {
        setRun(null);
        return;
      }
      if (!stage.current) return;
      await waitForLayout(stage.current);
      if (cancelled || !stage.current) return;
      const article =
        stage.current.querySelector<HTMLElement>('.slide-preview');
      if (!article) throw new Error('Missing slide canvas');
      const page = navigation[run.index];
      const names = new Map(
        page.elements.map((element) => [element.nodeId, element.name]),
      );
      const elements = Array.from(
        article.querySelectorAll<HTMLElement>('[data-node-id]'),
      ).filter(
        (element) => names.has(element.dataset.nodeId!) && measurable(element),
      );
      const measurements = elements.map((element) =>
        measureElement(element, names.get(element.dataset.nodeId!)!),
      );
      const footnoteTargets = footnoteSourceTargets(pages[run.index], names);
      for (const [index, note] of Array.from(
        article.querySelectorAll<HTMLLIElement>('.document-footnotes > li'),
      ).entries()) {
        if (!measurable(note)) continue;
        measurements.push(
          measureElement(
            note,
            `${locale === 'ja' ? '脚注' : 'Footnote'} ${note.value || index + 1}`,
            {
              nodeId: `generated-footnote-${run.index}-${index}`,
              focusNodeId: footnoteTargets[index] ?? page.anchorNodeId,
            },
          ),
        );
      }
      const measured = checkSlideGeometry(
        {
          page: run.index + 1,
          title: page.title,
          canvas: rectangle(article),
          footer: article.querySelector('footer')
            ? rectangle(article.querySelector('footer')!)
            : undefined,
          elements: measurements,
          clipped: clipped(article),
        },
        run.minimum,
      );
      const failedImages = Array.from(article.querySelectorAll('img')).filter(
        (image) => !image.complete || image.naturalWidth === 0,
      );
      const fallbacks = Array.from(
        article.querySelectorAll(
          '.preview-image-fallback, .preview-inline-image-fallback',
        ),
      );
      const imageNodes = new Set(
        [...failedImages, ...fallbacks].map(
          (element) =>
            element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ??
            page.anchorNodeId,
        ),
      );
      for (const nodeId of imageNodes)
        measured.push({
          id: `${run.index + 1}:image-unavailable:${nodeId ?? ''}`,
          kind: 'image-unavailable',
          page: run.index + 1,
          title: page.title,
          nodeId,
          name: names.get(nodeId ?? '') ?? page.title,
        });
      for (const image of Array.from(article.querySelectorAll('img'))) {
        if (!image.complete || !image.naturalWidth) continue;
        const source = image.currentSrc || image.src;
        const nodeId =
          image.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ??
          page.anchorNodeId;
        const original = Array.from(walkDocumentTree(pages[run.index])).find(
          (node) =>
            (node.type === 'figure' || node.type === 'inlineImage') &&
            node.attrs.nodeId === nodeId,
        );
        const originalSource =
          original &&
          (original.type === 'figure' || original.type === 'inlineImage')
            ? original.attrs.src
            : '';
        if (
          [source, originalSource].some((value) =>
            /^(data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(value),
          )
        )
          continue;
        const bounds = image.getBoundingClientRect();
        const pixelRatio = rasterPixelRatio(
          image.naturalWidth,
          image.naturalHeight,
          bounds.width,
          bounds.height,
        );
        if (pixelRatio === undefined || pixelRatio >= 0.95) continue;
        measured.push({
          id: `${run.index + 1}:image-low-resolution:${nodeId ?? ''}`,
          kind: 'image-low-resolution',
          page: run.index + 1,
          title: page.title,
          nodeId,
          name: names.get(nodeId ?? '') ?? page.title,
          pixelRatio,
        });
      }
      for (const graphic of Array.from(
        article.querySelectorAll<SVGSVGElement>('svg.figure-edit-graphic'),
      )) {
        const nodeId =
          graphic.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
        const node = Array.from(walkDocumentTree(pages[run.index])).find(
          (candidate) =>
            candidate.type === 'figure' && candidate.attrs.nodeId === nodeId,
        );
        if (node?.type !== 'figure') continue;
        const edit = readFigureEdit(node.attrs.figureEdit);
        if (
          !edit?.imageSize ||
          edit.svgSource ||
          /^(data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(node.attrs.src)
        )
          continue;
        const bounds = graphic.getBoundingClientRect();
        const pixelRatio = rasterPixelRatio(
          (edit.imageSize.width * (edit.crop?.width ?? 100)) / 100,
          (edit.imageSize.height * (edit.crop?.height ?? 100)) / 100,
          bounds.width,
          bounds.height,
        );
        if (pixelRatio === undefined || pixelRatio >= 0.95) continue;
        measured.push({
          id: `${run.index + 1}:image-low-resolution:${nodeId}`,
          kind: 'image-low-resolution',
          page: run.index + 1,
          title: page.title,
          nodeId,
          name: names.get(nodeId ?? '') ?? page.title,
          pixelRatio,
        });
      }
      const nextIssues = [...run.issues, ...measured];
      if (run.index + 1 < pages.length)
        setRun({ ...run, index: run.index + 1, issues: nextIssues });
      else {
        setResult({
          source: document,
          issues: nextIssues,
          count: pages.length,
          minimum: run.minimum,
        });
        setRun(null);
      }
    };
    void measure().catch(() => {
      if (!cancelled) {
        setFailure(true);
        setRun(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [document, locale, navigation, open, pages, run]);

  if (document.type !== 'slide') return null;
  const close = () => {
    setOpen(false);
    setRun(null);
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {ja ? '全ページをチェック' : 'Check all pages'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setRun(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {ja ? 'スライドの見た目チェック' : 'Slide layout check'}
            </DialogTitle>
            <DialogDescription>
              {ja
                ? 'はみ出し・重なり・小さい文字を確認します。内容は変更しません。数式の細かな文字と画像内の文字は検査対象外です。'
                : 'Checks overflow, overlaps and small text without changing content. Mathematical glyphs and text inside images are excluded.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">
              {ja
                ? '最小文字サイズ（幅920 px換算）'
                : 'Minimum font size (at 920 px width)'}
              <input
                type="number"
                min="8"
                max="28"
                step="1"
                value={minimum}
                disabled={!!run}
                onChange={(event) => setMinimum(event.target.value)}
                className="h-8 w-24 rounded border px-2"
              />
            </label>
            <Button
              disabled={!!run || !validMinimum || disabled}
              onClick={() => {
                setFailure(false);
                setRun({
                  source: document,
                  index: 0,
                  minimum: Number(minimum),
                  issues: [],
                });
              }}
            >
              {run
                ? ja
                  ? '検査中…'
                  : 'Checking…'
                : ja
                  ? '検査を実行'
                  : 'Run check'}
            </Button>
            {run && (
              <Button variant="outline" onClick={() => setRun(null)}>
                {ja ? '検査を中止' : 'Cancel check'}
              </Button>
            )}
          </div>
          <output aria-live="polite" className="text-sm">
            {run
              ? ja
                ? `${run.index + 1} / ${pages.length} ページを検査中`
                : `Checking page ${run.index + 1} / ${pages.length}`
              : failure
                ? ja
                  ? '検査を完了できませんでした。再実行してください。'
                  : 'The check could not be completed. Run it again.'
                : staleDocument
                  ? ja
                    ? '文書が変更されました。もう一度検査してください。'
                    : 'The document changed. Run the check again.'
                  : staleMinimum
                    ? ja
                      ? '検査条件が変更されました。もう一度検査してください。'
                      : 'The check settings changed. Run the check again.'
                    : result
                      ? ja
                        ? `${result.count}ページの検査完了：${issues.length}件の確認候補（除外${excludedIds.size}件）`
                        : `Checked ${result.count} pages: ${issues.length} items to review (${excludedIds.size} excluded)`
                      : ja
                        ? '「検査を実行」で全ページを確認できます。'
                        : 'Select Run check to review all pages.'}
          </output>
          {!run && !stale && issues.length > 0 && (
            <ul
              className="max-h-80 space-y-3 overflow-y-auto"
              aria-label={ja ? '検査結果' : 'Check results'}
            >
              {issues.map((issue) => {
                const text = issueText(issue, locale);
                return (
                  <li
                    key={issue.id}
                    className="space-y-2 rounded border p-3 text-xs"
                  >
                    <p className="font-medium">
                      {issue.page}. {issue.title} — {issue.name}
                    </p>
                    <p>{text.reason}</p>
                    <p className="text-muted-foreground">{text.suggestion}</p>
                    {slideCheckSuggestions(document, issue, locale).length >
                      0 && (
                      <ul
                        className="list-disc space-y-1 pl-4"
                        aria-label={
                          ja
                            ? '内容を保つ修正候補'
                            : 'Content-preserving suggestions'
                        }
                      >
                        {slideCheckSuggestions(document, issue, locale).map(
                          (suggestion) => (
                            <li key={suggestion}>{suggestion}</li>
                          ),
                        )}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!issue.nodeId && !onPageSelect}
                        onClick={() => {
                          close();
                          onPageSelect?.(issue.page - 1);
                          if (issue.nodeId) onFocus(issue.nodeId);
                        }}
                      >
                        {ja ? '対象を開く' : 'Open target'}
                      </Button>
                      {(issue.kind === 'overlap' ||
                        issue.kind === 'footer-overlap') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExcluded({
                              source: document,
                              ids: new Set([...excludedIds, issue.id]),
                            })
                          }
                        >
                          {ja
                            ? '意図した重なりとして除外'
                            : 'Exclude intentional overlap'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!run && excludedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setExcluded(null)}>
              {ja ? '除外した重なりを再表示' : 'Show excluded overlaps'}
            </Button>
          )}
        </DialogContent>
      </Dialog>
      {open && run && run.source === document && (
        <div
          ref={stage}
          data-slide-check-stage=""
          aria-hidden="true"
          inert
          style={{
            position: 'fixed',
            left: '-12000px',
            top: 0,
            width: referenceWidth,
            visibility: 'visible',
            pointerEvents: 'none',
          }}
        >
          <style>{`[data-slide-check-stage] .slide-preview{width:${referenceWidth}px!important;height:${referenceHeight}px!important;min-height:0!important;max-width:none!important;box-sizing:border-box!important;transform:none!important;}`}</style>
          <DocumentPage
            document={document}
            nodes={pages[run.index]}
            analysis={analysis}
            locale={locale}
            index={run.index}
            count={pages.length}
            resolveImageUrl={resolveImageUrl}
          />
        </div>
      )}
    </>
  );
}
