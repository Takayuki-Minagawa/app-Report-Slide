'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { DocumentMetadata, FigureNode } from '@/src/document/model';
import { createNodeId } from '@/src/document/model';
import {
  figureReferences,
  figureReferenceSchema,
  type FigureReference,
  type FigureEdit,
} from '@/src/document/figure-edit';
import type { BlockInsertionTarget } from '@/src/editor/block-commands';
import type { openPdf } from '@/src/pdf/pdf-renderer';
import type { ExtractionResult } from '@/src/document/extraction';
import { PdfExtractionReview } from './pdf-extraction-review';

type PdfSession = Awaited<ReturnType<typeof openPdf>>;
type Crop = NonNullable<FigureEdit['crop']>;
const whole: Crop = { x: 0, y: 0, width: 100, height: 100 };
export interface PdfFigureImport {
  image: File;
  pdf: File;
  existingAsset?: string;
  fileName: string;
  page: number;
  pageCount: number;
  dpi: number;
  imageSize: { width: number; height: number };
  crop: Crop;
  reference: FigureReference;
  printedPage: string;
  figureNumber: string;
  target: BlockInsertionTarget;
  replaceNodeId?: string;
  extraction?: ExtractionResult;
}

/** Render only the page chosen by the user. The original PDF and full page remain separate from the crop. */
export function PdfImportDialog({
  node,
  metadata,
  target = 'after-block',
  resolveAssetUrl,
  onApply,
  onClose,
}: {
  node?: FigureNode;
  metadata: DocumentMetadata;
  target?: BlockInsertionTarget;
  resolveAssetUrl: (source: string) => string;
  onApply: (value: PdfFigureImport) => Promise<void>;
  onClose: () => void;
}) {
  const ja = useAppPreferences().locale === 'ja';
  const t = useCallback((j: string, e: string) => (ja ? j : e), [ja]);
  const original = node?.attrs.figureEdit?.pdfSource;
  const references = figureReferences(metadata);
  const [reference, setReference] = useState<FigureReference>(
    () =>
      references.find(
        (r) => r.id === node?.attrs.figureEdit?.source?.referenceId,
      ) ?? {
        id: `pdf-${createNodeId()}`,
        title: original?.fileName ?? '',
        authors: '',
        year: '',
        url: '',
      },
  );
  const [file, setFile] = useState<File>();
  const [existingAsset, setExistingAsset] = useState(original?.asset);
  const [password, setPassword] = useState('');
  const [passwordNeeded, setPasswordNeeded] = useState(false);
  const [session, setSession] = useState<PdfSession>();
  const [page, setPage] = useState(original?.page ?? 1);
  const [dpi, setDpi] = useState(original?.dpi ?? 144);
  const [zoom, setZoom] = useState(100);
  const [crop, setCrop] = useState<Crop>(node?.attrs.figureEdit?.crop ?? whole);
  const [rendered, setRendered] = useState<{
    blob: Blob;
    width: number;
    height: number;
    actualDpi: number;
    url: string;
  }>();
  const [printedPage, setPrintedPage] = useState(
    node?.attrs.figureEdit?.source?.printedPage ?? '',
  );
  const [figureNumber, setFigureNumber] = useState(
    node?.attrs.figureEdit?.source?.figureNumber ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [pendingDraftAction, setPendingDraftAction] = useState<{
    label: string;
    run: () => void;
  }>();
  const protectDraft = (label: string, run: () => void) => {
    if (reviewDraft) setPendingDraftAction({ label, run });
    else run();
  };
  const handleDraftChange = useCallback((draft: boolean) => {
    setReviewDraft(draft);
    if (!draft) setPendingDraftAction(undefined);
  }, []);
  const discardDraftAndContinue = () => {
    if (!pendingDraftAction) return;
    const run = pendingDraftAction.run;
    setPendingDraftAction(undefined);
    setReviewDraft(false);
    setExtraction(undefined);
    // Every guarded action closes this dialog or invalidates the extraction.
    // Remount the review so even a new drag starts with no hidden TSV draft.
    setReviewRevision((value) => value + 1);
    run();
  };
  const sourceSection = useRef<HTMLDivElement>(null);
  const reviewSection = useRef<HTMLDivElement>(null);
  const resumeTsvFocus = useRef(false);
  useEffect(() => {
    if (pendingDraftAction || !reviewOpen || !resumeTsvFocus.current) return;
    const textarea =
      reviewSection.current?.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) return;
    resumeTsvFocus.current = false;
    const disclosure = textarea.closest('details');
    if (disclosure) disclosure.open = true;
    textarea.focus({ preventScroll: true });
    textarea.scrollIntoView({ block: 'center' });
  }, [pendingDraftAction, reviewOpen]);
  const sourceId = useId();
  const reviewId = useId();
  const goTo = (section: 'source' | 'review') => {
    if (section === 'review') setReviewOpen(true);
    requestAnimationFrame(() => {
      const element =
        section === 'source' ? sourceSection.current : reviewSection.current;
      element?.scrollIntoView({ block: 'start' });
      const focus =
        section === 'review'
          ? element?.querySelector<HTMLElement>('summary')
          : element;
      focus?.focus({ preventScroll: true });
    });
  };
  const [error, setError] = useState('');
  const resources = useRef<{
    revision: number;
    session?: PdfSession;
    url?: string;
  }>({ revision: 0 });
  const drag = useRef<{ x: number; y: number; previous: Crop } | undefined>(
    undefined,
  );

  const load = useCallback(
    async (next: File, nextPassword?: string) => {
      const request = ++resources.current.revision;
      setBusy(true);
      setError('');
      setRendered(undefined);
      setSession(undefined);
      if (resources.current.url) {
        URL.revokeObjectURL(resources.current.url);
        resources.current.url = undefined;
      }
      const previous = resources.current.session;
      resources.current.session = undefined;
      await previous?.destroy();
      try {
        const { openPdf, PdfPasswordError } =
          await import('@/src/pdf/pdf-renderer');
        try {
          const opened = await openPdf(next, nextPassword);
          if (request !== resources.current.revision) {
            await opened.destroy();
            return;
          }
          resources.current.session = opened;
          setSession(opened);
          setPage((current) => Math.min(current, opened.pageCount));
          setPasswordNeeded(false);
          setPassword('');
        } catch (cause) {
          if (request !== resources.current.revision) return;
          if (cause instanceof PdfPasswordError) {
            setPasswordNeeded(true);
            setError(
              t(
                'PDFのパスワードを入力してください。パスワードは保存しません。',
                'Enter the PDF password. It is never saved.',
              ),
            );
          } else throw cause;
        }
      } catch (cause) {
        if (request === resources.current.revision)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (request === resources.current.revision) setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const retained = resources.current;
    const initialRevision = retained.revision;
    let active = true;
    if (original) {
      const url = resolveAssetUrl(original.asset);
      void Promise.resolve()
        .then(() => {
          if (!url.startsWith('blob:'))
            throw new Error(
              t(
                '元PDFが見つかりません。元のPDFファイルを選択してください。',
                'Original PDF is missing. Select its file again.',
              ),
            );
          return fetch(url);
        })
        .then((response) => {
          if (!response.ok) throw new Error('PDF could not be read');
          return response.blob();
        })
        .then((blob) => {
          if (!active || retained.revision !== initialRevision) return;
          const restored = new File([blob], original.fileName, {
            type: 'application/pdf',
          });
          setFile(restored);
          void load(restored);
        })
        .catch((cause) => {
          if (active && retained.revision === initialRevision)
            setError(String(cause));
        });
    }
    return () => {
      active = false;
      retained.revision++;
      void retained.session?.destroy();
      retained.session = undefined;
      if (retained.url) URL.revokeObjectURL(retained.url);
    };
  }, [original, resolveAssetUrl, load, t]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void session
      .renderPage(page, dpi)
      .then((result) => {
        if (!active) return;
        if (resources.current.url) URL.revokeObjectURL(resources.current.url);
        const url = URL.createObjectURL(result.blob);
        resources.current.url = url;
        setRendered({ ...result, url });
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [session, page, dpi]);

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    };
  };
  const updateDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const end = point(event),
      start = drag.current;
    const width = Math.max(1, Math.abs(end.x - start.x)),
      height = Math.max(1, Math.abs(end.y - start.y));
    setCrop({
      x: Math.min(100 - width, Math.min(start.x, end.x)),
      y: Math.min(100 - height, Math.min(start.y, end.y)),
      width,
      height,
    });
  };
  const updateCrop = (key: keyof Crop, value: number) => {
    if (!Number.isFinite(value)) return;
    protectDraft(t('読み取り範囲を変更', 'Change the recognition region'), () =>
      setCrop((current) => {
        const next = {
          ...current,
          [key]: Math.max(
            key === 'x' || key === 'y' ? 0 : 1,
            Math.min(100, value),
          ),
        };
        if (key === 'x') next.x = Math.min(next.x, 100 - next.width);
        if (key === 'y') next.y = Math.min(next.y, 100 - next.height);
        next.width = Math.min(next.width, 100 - next.x);
        next.height = Math.min(next.height, 100 - next.y);
        return next;
      }),
    );
  };
  const validReference = figureReferenceSchema.safeParse(reference).success;
  const apply = async (reviewed?: ExtractionResult) => {
    if (
      !file ||
      !rendered ||
      !session ||
      !validReference ||
      busy ||
      applying ||
      recognizing ||
      reviewDraft
    )
      return;
    setApplying(true);
    setError('');
    try {
      await onApply({
        image: new File([rendered.blob], `pdf-page-${page}.png`, {
          type: 'image/png',
        }),
        pdf: file,
        existingAsset,
        fileName: file.name,
        page,
        pageCount: session.pageCount,
        dpi: rendered.actualDpi,
        imageSize: { width: rendered.width, height: rendered.height },
        crop,
        reference,
        printedPage,
        figureNumber,
        target,
        replaceNodeId: node?.attrs.nodeId,
        ...(reviewed ? { extraction: reviewed } : {}),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying)
          protectDraft(t('PDF取り込みを閉じる', 'Close PDF import'), onClose);
      }}
    >
      <DialogContent
        className="flex max-h-[94vh] w-[1180px] flex-col gap-3 overflow-clip sm:max-w-[calc(100%-2rem)]"
        closeLabel={t('PDF取り込みを閉じる', 'Close PDF import')}
        showCloseButton={!applying}
      >
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>
            {t(
              node ? '元PDFから取り込み直す' : 'PDFから図を取り込む',
              node ? 'Reimport from original PDF' : 'Import a figure from PDF',
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              'PDFはこのブラウザー内で処理します。HTML・ZIPには元PDF全体とページ画像を保存するため、後から切り抜き直せます。',
              'PDFs are processed in this browser. HTML and ZIP retain the entire original PDF and page image for later recropping.',
            )}
          </DialogDescription>
        </DialogHeader>
        {pendingDraftAction && reviewDraft && (
          <div
            role="alert"
            className="shrink-0 space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          >
            <p>
              {t(
                `「${pendingDraftAction.label}」はまだ実行していません。未反映のTSVがあります。編集に戻るか、読み取り結果と未反映の編集を破棄して続けてください。`,
                `“${pendingDraftAction.label}” has not run. There is an unapplied TSV draft. Return to editing, or discard this recognition result and its draft to continue.`,
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  // Move focus off the disappearing button before removing it.
                  // Otherwise Base UI restores focus to the popup next frame.
                  event.currentTarget
                    .closest<HTMLElement>('[role="dialog"]')
                    ?.focus({ preventScroll: true });
                  resumeTsvFocus.current = true;
                  setReviewOpen(true);
                  setPendingDraftAction(undefined);
                }}
              >
                {t('TSV編集に戻る', 'Return to TSV editing')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={discardDraftAndContinue}
              >
                {t('TSV編集を破棄して続行', 'Discard TSV edits and continue')}
              </Button>
            </div>
          </div>
        )}
        <nav
          aria-label={t('PDF取込の操作', 'PDF import steps')}
          className="flex shrink-0 flex-wrap gap-2"
        >
          <Button
            size="sm"
            variant="outline"
            aria-controls={sourceId}
            onClick={() => goTo('source')}
          >
            {t('1. 範囲・出典を確認', '1. Region and source')}
          </Button>
          {!node && (
            <Button
              size="sm"
              variant="outline"
              aria-controls={reviewId}
              aria-expanded={reviewOpen}
              disabled={!rendered}
              onClick={() => goTo('review')}
            >
              {t('2. 文字・表を読み取る', '2. Read text and tables')}
            </Button>
          )}
        </nav>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
          <div
            ref={sourceSection}
            id={sourceId}
            tabIndex={-1}
            className="flex scroll-mt-1 flex-wrap items-end gap-3 outline-none"
          >
            <label className="grid gap-1 text-xs">
              {t('PDFファイル（20 MBまで）', 'PDF file (up to 20 MB)')}
              <input
                aria-label={t('取り込むPDFファイル', 'PDF file to import')}
                type="file"
                accept="application/pdf,.pdf"
                disabled={applying}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  event.target.value = '';
                  if (!next) return;
                  protectDraft(
                    t('PDFファイルを変更', 'Change PDF file'),
                    () => {
                      setFile(next);
                      setExistingAsset(undefined);
                      setPage(1);
                      setCrop(whole);
                      setPassword('');
                      setPasswordNeeded(false);
                      setReference((current) => ({
                        ...current,
                        title:
                          current.title || next.name.replace(/\.pdf$/i, ''),
                      }));
                      void load(next);
                    },
                  );
                }}
              />
            </label>
            {file && <span className="text-xs break-all">{file.name}</span>}
            {passwordNeeded && (
              <>
                <Input
                  aria-label={t('PDFパスワード', 'PDF password')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-48"
                />
                <Button
                  disabled={busy || !file}
                  onClick={() => file && void load(file, password)}
                >
                  {t('PDFを開く', 'Open PDF')}
                </Button>
              </>
            )}
          </div>
          {session && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label>
                {t('PDFページ', 'PDF page')}{' '}
                <select
                  aria-label={t('PDFページ', 'PDF page')}
                  value={page}
                  disabled={applying}
                  onChange={(e) => {
                    const nextPage = Number(e.target.value);
                    protectDraft(
                      t('PDFページを変更', 'Change PDF page'),
                      () => {
                        setRendered(undefined);
                        setBusy(true);
                        setError('');
                        setPage(nextPage);
                        setCrop(whole);
                      },
                    );
                  }}
                >
                  {Array.from({ length: session.pageCount }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1} / {session.pageCount}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('解像度', 'Resolution')}{' '}
                <select
                  aria-label={t('PDF解像度', 'PDF resolution')}
                  value={dpi}
                  disabled={applying}
                  onChange={(e) => {
                    const nextDpi = Number(e.target.value);
                    protectDraft(
                      t('PDF解像度を変更', 'Change PDF resolution'),
                      () => {
                        setRendered(undefined);
                        setBusy(true);
                        setError('');
                        setDpi(nextDpi);
                      },
                    );
                  }}
                >
                  {[72, 144, 216, 288].map((value) => (
                    <option key={value} value={value}>
                      {value} dpi
                    </option>
                  ))}
                  {![72, 144, 216, 288].includes(dpi) && (
                    <option value={dpi}>{Math.round(dpi)} dpi</option>
                  )}
                </select>
              </label>
              <label>
                {t('拡大率', 'Zoom')}{' '}
                <select
                  aria-label={t('PDF表示倍率', 'PDF zoom')}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  {[75, 100, 150, 200].map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>
              {rendered && (
                <span>
                  {rendered.width} × {rendered.height} px ·{' '}
                  {Math.round(rendered.actualDpi)} dpi
                  {rendered.actualDpi < dpi - 0.01 &&
                    t(
                      '（画像サイズの上限に合わせて調整）',
                      ' (adjusted to the image size limit)',
                    )}
                </span>
              )}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="min-w-0">
              <p className="mb-2 text-xs">
                {t(
                  'ページ上をドラッグして範囲を選択。数値でも指定できます。',
                  'Drag over the page to select a region, or enter its coordinates.',
                )}
              </p>
              <div className="max-h-[58vh] min-h-48 overflow-auto rounded border bg-slate-100 p-2">
                {rendered && (
                  <svg
                    aria-label={t('PDF切り抜き範囲', 'PDF crop selection')}
                    viewBox={`0 0 ${rendered.width} ${rendered.height}`}
                    style={{
                      width: `${zoom * 5}px`,
                      maxWidth: 'none',
                      touchAction: 'none',
                      display: 'block',
                    }}
                    onPointerDown={(e) => {
                      if (applying || e.button !== 0) return;
                      e.preventDefault();
                      if (reviewDraft) {
                        protectDraft(
                          t('範囲を選び直す', 'Select a new region'),
                          () => {},
                        );
                        return;
                      }
                      drag.current = { ...point(e), previous: crop };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={updateDrag}
                    onPointerUp={(e) => {
                      updateDrag(e);
                      drag.current = undefined;
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        e.currentTarget.releasePointerCapture(e.pointerId);
                    }}
                    onPointerCancel={() => {
                      if (drag.current) setCrop(drag.current.previous);
                      drag.current = undefined;
                    }}
                  >
                    <image
                      href={rendered.url}
                      width={rendered.width}
                      height={rendered.height}
                    />
                    <rect
                      x={(crop.x / 100) * rendered.width}
                      y={(crop.y / 100) * rendered.height}
                      width={(crop.width / 100) * rendered.width}
                      height={(crop.height / 100) * rendered.height}
                      fill="#2563eb"
                      fillOpacity="0.12"
                      stroke="#2563eb"
                      strokeWidth={Math.max(rendered.width / 250, 2)}
                    />
                  </svg>
                )}
                {!rendered && (
                  <output className="block p-8 text-center text-sm">
                    {busy || (session && !error)
                      ? t(
                          'PDFを読み込み・描画しています…',
                          'Reading and rendering PDF…',
                        )
                      : t(
                          'PDFを選択するとページを表示します。',
                          'Choose a PDF to display its pages.',
                        )}
                  </output>
                )}
              </div>
            </div>
            <fieldset disabled={applying} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((key, index) => (
                  <label key={key} className="grid gap-1 text-xs">
                    {
                      [
                        t('左位置', 'Left'),
                        t('上位置', 'Top'),
                        t('幅', 'Width'),
                        t('高さ', 'Height'),
                      ][index]
                    }{' '}
                    (%)
                    <Input
                      aria-label={`${t('PDF範囲', 'PDF crop')} ${key}`}
                      type="number"
                      min={key === 'x' || key === 'y' ? 0 : 1}
                      max={100}
                      step="0.1"
                      value={Math.round(crop[key] * 100) / 100}
                      onChange={(e) => updateCrop(key, e.target.valueAsNumber)}
                    />
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  protectDraft(t('ページ全体に戻す', 'Use full page'), () =>
                    setCrop(whole),
                  )
                }
              >
                {t('ページ全体に戻す', 'Use full page')}
              </Button>
              <details>
                <summary className="cursor-pointer font-medium">
                  {t('出典を確認', 'Confirm source')}
                </summary>
                <div className="mt-2 space-y-2">
                  {references.length > 0 && (
                    <label className="grid gap-1 text-xs">
                      {t('登録済み文献', 'Saved reference')}
                      <select
                        aria-label={t(
                          'PDFの登録済み文献',
                          'Saved PDF reference',
                        )}
                        value={
                          references.some((r) => r.id === reference.id)
                            ? reference.id
                            : ''
                        }
                        onChange={(e) => {
                          const found = references.find(
                            (r) => r.id === e.target.value,
                          );
                          if (found) setReference(found);
                          else
                            setReference({
                              id: `pdf-${createNodeId()}`,
                              title: file?.name ?? '',
                              authors: '',
                              year: '',
                              url: '',
                            });
                        }}
                      >
                        <option value="">
                          {t('新しい文献', 'New reference')}
                        </option>
                        {references.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.title || r.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(['title', 'authors', 'year', 'url'] as const).map(
                    (key, index) => (
                      <label key={key} className="grid gap-1 text-xs">
                        {
                          [
                            t('文献の題名', 'Reference title'),
                            t('著者', 'Authors'),
                            t('年', 'Year'),
                            t('文献URL', 'Reference URL'),
                          ][index]
                        }
                        <Input
                          aria-label={`${t('PDF出典', 'PDF source')} ${key}`}
                          value={reference[key]}
                          maxLength={
                            key === 'year' ? 40 : key === 'url' ? 2000 : 1000
                          }
                          onChange={(e) =>
                            setReference((current) => ({
                              ...current,
                              [key]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ),
                  )}
                  <label className="grid gap-1 text-xs">
                    {t('論文内ページ', 'Printed page')}
                    <Input
                      aria-label={t('PDFの論文内ページ', 'PDF printed page')}
                      value={printedPage}
                      maxLength={40}
                      onChange={(e) => setPrintedPage(e.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    {t('図表番号', 'Figure number')}
                    <Input
                      aria-label={t('PDFの図表番号', 'PDF figure number')}
                      value={figureNumber}
                      maxLength={100}
                      onChange={(e) => setFigureNumber(e.target.value)}
                    />
                  </label>
                </div>
              </details>
              <p className="text-xs text-muted-foreground">
                {t(
                  '文献情報は確認して入力してください。文字・表の読み取り結果は、原本と照合してから挿入できます。',
                  'Check the reference details. Recognized text and tables can be inserted after review against the original.',
                )}
              </p>
              {node && page !== original?.page && (
                <p className="text-xs">
                  {t(
                    '別ページへ変更するため、元ページの注釈は取り除きます。',
                    'Annotations on the old page will be removed when choosing a different page.',
                  )}
                </p>
              )}
            </fieldset>
          </div>
          {!node && (
            <div ref={reviewSection} id={reviewId} className="scroll-mt-1">
              <PdfExtractionReview
                key={reviewRevision}
                session={session}
                page={page}
                rendered={rendered}
                crop={crop}
                ja={ja}
                disabled={applying || busy}
                onChange={setExtraction}
                onBusyChange={setRecognizing}
                onDraftChange={handleDraftChange}
                open={reviewOpen}
                onOpenChange={setReviewOpen}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!validReference && (
            <p role="alert" className="text-sm text-destructive">
              {t(
                '文献URLはhttp://またはhttps://で入力してください。',
                'Use an http:// or https:// reference URL.',
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-popover pt-3">
          {reviewDraft && (
            <output className="basis-full text-xs">
              {t(
                '未反映のTSVがあります。「TSVを表に反映」または「TSVの編集を取り消す」を選んでください。',
                'There is an unapplied TSV draft. Choose Apply TSV to table or Cancel TSV edits.',
              )}
            </output>
          )}
          <Button
            variant="outline"
            disabled={applying}
            onClick={() =>
              protectDraft(
                t('PDF取り込みを閉じる', 'Close PDF import'),
                onClose,
              )
            }
          >
            {t('キャンセル', 'Cancel')}
          </Button>
          {extraction && (
            <Button
              disabled={
                !rendered ||
                busy ||
                applying ||
                recognizing ||
                reviewDraft ||
                !validReference
              }
              onClick={() => void apply(extraction)}
            >
              {applying
                ? t('取り込み中…', 'Importing…')
                : t(
                    '原本と確認済みの内容を挿入',
                    'Insert original and reviewed content',
                  )}
            </Button>
          )}
          <Button
            disabled={
              !rendered ||
              busy ||
              applying ||
              recognizing ||
              reviewDraft ||
              !validReference
            }
            onClick={() => void apply()}
          >
            {applying
              ? t('取り込み中…', 'Importing…')
              : t(
                  node ? 'この図を更新' : '選択範囲を図として挿入',
                  node ? 'Update this figure' : 'Insert selected region',
                )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
