import DOMPurify from 'dompurify';
import { importDocumentData } from './import-document';
import { preservedContent } from '@/src/document/preserved-content';
import {
  createNodeId,
  type DocumentData,
  type DocumentNode,
  type InlineNode,
  type Mark,
  type ParagraphNode,
  type TableNode,
} from '@/src/document/model';
import {
  migrateDocumentData,
  validateDocumentData,
} from '@/src/document/validation';
import { resolveDocumentTheme } from '@/src/document/metadata';
import { splitDocumentPages } from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import { referencedAssets } from '@/src/document/assets';
import { validatePdfBytes } from '@/src/document/pdf-source';
import { safeResourceUrl } from '@/src/security/resource-url';
import {
  editableHtmlFormat,
  editableHtmlId,
  editableHtmlVersion,
} from '@/src/export/editable-html';
import { registerAssetUrl, revokeAssetUrls, type AssetUrls } from './files';

export const maximumHtmlBytes = 150 * 1024 * 1024;
const maximumExternalHtmlBytes = 5 * 1024 * 1024;
const maximumImageBytes = 20 * 1024 * 1024;
const maximumAllImageBytes = 50 * 1024 * 1024;
const maximumNodes = 30000;
const maximumPages = 500;

export interface HtmlImportSummary {
  kind: 'editable' | 'converted';
  pageCount: number;
  nodeCount: number;
  warnings: string[];
}

export interface HtmlImportResult {
  document: DocumentData;
  assets: AssetUrls;
  htmlImport: HtmlImportSummary;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bound nesting before calling recursive model validation, including arbitrary metadata. */
function checkJsonBudget(value: unknown): void {
  const stack = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (++count > 500000 || entry.depth > 64)
      throw new Error('編集用HTMLの構造が上限を超えています（深さ64）。');
    if (entry.value && typeof entry.value === 'object') {
      for (const child of Object.values(entry.value))
        stack.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

function checkHtmlBudget(root: DocumentFragment): void {
  const stack = [{ node: root as Node, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (++count > maximumNodes || entry.depth > 64)
      throw new Error(
        'HTMLの構造が上限を超えています（30,000ノード、深さ64）。',
      );
    for (const node of entry.node.childNodes)
      stack.push({ node, depth: entry.depth + 1 });
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[a-z\d+/]*={0,2}$/i.test(value) || value.length % 4 !== 0)
    throw new Error('編集用HTMLのBase64データが不正です。');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function imageData(
  value: string,
  kind: 'image' | 'pdf' = 'image',
): {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
} {
  if (kind === 'pdf') {
    const pdf = /^data:application\/pdf;base64,([a-z\d+/]*={0,2})$/i.exec(
      value,
    );
    if (!pdf || pdf[1].length > Math.ceil(maximumImageBytes / 3) * 4)
      throw new Error('PDF原本の埋込形式またはサイズが不正です。');
    const bytes = decodeBase64(pdf[1]);
    validatePdfBytes(bytes);
    return { bytes, mime: 'application/pdf' };
  }
  const match =
    /^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml))(;base64|;charset=utf-8)?,([\s\S]*)$/i.exec(
      value,
    );
  if (!match) throw new Error('HTMLの埋込画像形式に対応していません。');
  // Check encoded size before allocating the decoded buffer.
  if (match[3].length > maximumImageBytes * 3)
    throw new Error('HTMLの画像が20 MiBを超えています。');
  const bytes =
    match[2]?.toLowerCase() === ';base64'
      ? decodeBase64(match[3])
      : new TextEncoder().encode(decodeURIComponent(match[3]));
  if (bytes.byteLength > maximumImageBytes)
    throw new Error('HTMLの画像が20 MiBを超えています。');
  return { bytes, mime: match[1].toLowerCase() };
}

/** SVG is retained as one safe image; scripts, foreign documents and network references are removed. */
function sanitizeSvg(bytes: Uint8Array<ArrayBuffer>): {
  bytes: Uint8Array<ArrayBuffer>;
  changed: boolean;
} {
  const original = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const clean = DOMPurify.sanitize(original, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'style',
      'foreignObject',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
    ],
  });
  let changed = DOMPurify.removed.length > 0;
  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror'))
    throw new Error('HTMLのSVG画像が不正です。');
  for (const element of [root, ...root.querySelectorAll('*')]) {
    // Snapshot this live attribute collection before removing entries.
    const attributes = Array.from(element.attributes);
    for (const attr of attributes) {
      if (attr.name === 'style') {
        const safeProperties = new Set([
          'fill',
          'fill-opacity',
          'fill-rule',
          'stroke',
          'stroke-width',
          'stroke-opacity',
          'stroke-linecap',
          'stroke-linejoin',
          'stroke-dasharray',
          'stroke-dashoffset',
          'stroke-miterlimit',
          'font-family',
          'font-size',
          'font-weight',
          'font-style',
          'text-anchor',
          'dominant-baseline',
          'opacity',
          'display',
          'visibility',
          'paint-order',
          'stop-color',
          'stop-opacity',
          'clip-path',
          'mask',
          'filter',
          'vector-effect',
          'color',
          'text-decoration',
        ]);
        const declarations = attr.value
          .split(';')
          .map((declaration) => declaration.trim())
          .filter(Boolean);
        const safe = declarations.filter((declaration) => {
          const colon = declaration.indexOf(':');
          const property = declaration.slice(0, colon).trim().toLowerCase();
          const value = declaration.slice(colon + 1).trim();
          return (
            colon > 0 &&
            safeProperties.has(property) &&
            value.length < 1000 &&
            !/[\\<>@]/.test(value) &&
            !/expression|javascript|vbscript|behavior/i.test(value) &&
            (!/url\s*\(/i.test(value) ||
              /^url\(\s*['"]?#[a-z\d_.:-]+['"]?\s*\)$/i.test(value))
          );
        });
        if (safe.length !== declarations.length) changed = true;
        if (safe.length) element.setAttribute('style', safe.join(';'));
        else element.removeAttribute('style');
        continue;
      }
      const isReference = /^(?:href|xlink:href|src)$/i.test(attr.name);
      const unsafeReference =
        isReference && !/^#[a-z\d_.:-]+$/i.test(attr.value);
      const unsafePaint =
        /url\s*\(/i.test(attr.value) &&
        !/^url\(\s*['"]?#[a-z\d_.:-]+['"]?\s*\)$/i.test(attr.value);
      if (unsafeReference || unsafePaint || /^on/i.test(attr.name)) {
        element.removeAttributeNode(attr);
        changed = true;
      }
    }
  }
  return {
    bytes: new TextEncoder().encode(
      new XMLSerializer().serializeToString(root),
    ),
    changed,
  };
}

class ImportAssets {
  readonly urls = new Map<string, string>();
  readonly warnings: string[] = [];
  private total = 0;
  private serial = 0;
  private byData = new Map<string, string>();

  add(data: string, source?: string, kind: 'image' | 'pdf' = 'image'): string {
    const decoded = imageData(data, kind);
    const previous = this.byData.get(data);
    if (previous) {
      if (!source) return previous;
      if (this.urls.has(source))
        throw new Error('編集用HTMLの画像キーが重複しています。');
      this.urls.set(source, this.urls.get(previous)!);
      return source;
    }
    let bytes = decoded.bytes;
    const mime = decoded.mime;
    this.total += bytes.byteLength;
    if (this.total > maximumAllImageBytes)
      throw new Error('HTMLの画像合計が50 MiBを超えています。');
    if (mime === 'image/svg+xml') {
      const clean = sanitizeSvg(bytes);
      bytes = clean.bytes;
      if (clean.changed)
        this.warnings.push(
          'SVGのスクリプト、外部参照、動的要素またはCSSを除去しました。画像の見た目を確認してください。',
        );
    }
    const key =
      source ??
      `assets/html-import-${++this.serial}.${mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1]}`;
    if (this.urls.has(key))
      throw new Error('編集用HTMLの画像キーが重複しています。');
    this.urls.set(
      key,
      registerAssetUrl(
        URL.createObjectURL(new Blob([bytes], { type: mime })),
        bytes.byteLength,
      ),
    );
    this.byData.set(data, key);
    return key;
  }
}

function summarize(
  document: DocumentData,
  kind: HtmlImportSummary['kind'],
  warnings: string[],
): HtmlImportSummary {
  const pageCount = splitDocumentPages(document).length;
  const nodeCount = [...walkDocumentTree(document.children)].length;
  if (pageCount > maximumPages || nodeCount > maximumNodes)
    throw new Error(
      'HTML取込の上限を超えています（500ページ、30,000ノード）。',
    );
  return { kind, pageCount, nodeCount, warnings: [...new Set(warnings)] };
}

function restoreEmbedded(
  template: Element,
  assets: ImportAssets,
): HtmlImportResult {
  if (
    template.localName !== 'template' ||
    template.getAttribute('data-encoding') !== 'base64'
  )
    throw new Error('編集用HTMLの埋込データ形式が不正です。');
  const encoded =
    (template as HTMLTemplateElement).content.textContent?.trim() ?? '';
  const value: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(encoded)),
  );
  checkJsonBudget(value);
  if (
    !record(value) ||
    value.format !== editableHtmlFormat ||
    value.version !== editableHtmlVersion ||
    !Array.isArray(value.assets)
  )
    throw new Error('編集用HTMLの形式またはバージョンに対応していません。');
  if (
    Object.keys(value).some(
      (key) => !['format', 'version', 'document', 'assets'].includes(key),
    )
  )
    throw new Error('編集用HTMLに未知の項目があります。');
  const document = importDocumentData(value.document);
  const references = referencedAssets(document.children, document.metadata);
  const sources = new Map(references.map(({ source, kind }) => [source, kind]));
  for (const asset of value.assets) {
    if (
      !record(asset) ||
      typeof asset.source !== 'string' ||
      typeof asset.data !== 'string' ||
      !sources.has(asset.source) ||
      /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(asset.source)
    )
      throw new Error('編集用HTMLの画像参照が不正です。');
    assets.add(asset.data, asset.source, sources.get(asset.source));
  }
  const local = [...sources.keys()].filter(
    (source) => !/^(?:https?:|data:)/i.test(source),
  );
  if (local.some((source) => !assets.urls.has(source)))
    throw new Error('編集用HTMLの画像データが不足しています。');
  const remote = [...sources.keys()].filter((source) =>
    /^https?:/i.test(source),
  );
  const previousReport = document.metadata.html_import;
  const previousWarnings =
    record(previousReport) && Array.isArray(previousReport.warnings)
      ? previousReport.warnings.filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : [];
  const warnings = [...previousWarnings, ...assets.warnings];
  if (
    preservedContent(document.metadata).some((entry) => entry.format === 'json')
  )
    warnings.push(
      '未対応要素の原データを保持しています。プロパティの「保持した取込原データ」から確認できます。',
    );
  if (remote.length)
    warnings.push(
      `外部URLの画像 ${remote.length} 件は通信に依存します。内容・表示可否は検証していません。`,
    );
  return {
    document,
    assets: assets.urls,
    htmlImport: summarize(document, 'editable', warnings),
  };
}

const skippedTags = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'title',
  'head',
  'template',
]);
const unsupportedTags = new Set([
  'iframe',
  'object',
  'embed',
  'canvas',
  'video',
  'audio',
  'input',
  'select',
  'textarea',
  'button',
]);
const blockTags = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'blockquote',
  'pre',
  'figure',
  'hr',
  'svg',
  'img',
]);

class HtmlConverter {
  readonly warnings: string[] = [
    '外部HTMLを編集用の標準レイアウトへ変換しました。元のCSS、絶対位置、書体、色、動作は再現しません。内容と改ページを確認してください。',
  ];
  private removed = new Map<string, number>();
  private converted = new Set<string>();
  constructor(private readonly assets: ImportAssets) {}

  private attrs() {
    return { nodeId: createNodeId() };
  }
  private paragraph(content: InlineNode[] = []): ParagraphNode {
    return { type: 'paragraph', attrs: this.attrs(), content };
  }
  private note(tag: string) {
    this.removed.set(tag, (this.removed.get(tag) ?? 0) + 1);
  }

  private image(
    element: Element,
  ): { src: string; alt: string; title: string | null } | undefined {
    const alt =
      element.getAttribute('alt') ?? element.getAttribute('aria-label') ?? '';
    let src = element.getAttribute('src')?.trim() ?? '';
    if (element.localName === 'svg') {
      const bytes = new TextEncoder().encode(
        new XMLSerializer().serializeToString(element),
      );
      // An encoded data URI uses the same limit/sanitization path as embedded images.
      src =
        'data:image/svg+xml,' +
        encodeURIComponent(new TextDecoder().decode(bytes));
      this.warnings.push(
        'SVGは1枚の画像として取り込みます。SVG内部の文字や図形は個別編集できません。',
      );
    }
    if (src.startsWith('data:')) {
      try {
        src = this.assets.add(src);
      } catch (error) {
        // Size violations abort atomically; malformed images become an explicit text alternative.
        if (error instanceof Error && /MiB|上限/.test(error.message))
          throw error;
        this.warnings.push(
          `埋込画像を読み込めませんでした（${alt || '代替テキストなし'}）。`,
        );
        return undefined;
      }
    } else {
      const safe = safeResourceUrl(src, 'image');
      if (!safe) {
        this.warnings.push(
          `安全でない、または空の画像URLを除去しました（${alt || '代替テキストなし'}）。`,
        );
        return undefined;
      }
      src = safe;
      this.warnings.push(
        /^https?:/i.test(src)
          ? `外部画像は通信に依存し、内容・表示可否は未検証です: ${src}`
          : `相対パスの画像は添付ファイルが必要です: ${src}`,
      );
    }
    return { src, alt, title: element.getAttribute('title') };
  }

  private math(element: Element): string | undefined {
    if (
      element.localName === 'script' &&
      /^math\/tex(?:;|$)/i.test(element.getAttribute('type') ?? '')
    )
      return element.textContent ?? '';
    const direct =
      element.getAttribute('data-latex') ?? element.getAttribute('data-tex');
    if (direct !== null) return direct;
    if (element.matches('math, .katex, .katex-display, mjx-container')) {
      const tex = element.querySelector(
        'annotation[encoding="application/x-tex"]',
      )?.textContent;
      if (tex) return tex;
      this.warnings.push(
        'TeXソースを持たない数式を文字として取り込みました。数式の正確さを確認してください。',
      );
      return undefined;
    }
    return undefined;
  }

  inline(nodes: Iterable<Node>, marks: Mark[] = []): InlineNode[] {
    const result: InlineNode[] = [];
    for (const node of nodes) {
      if (node.nodeType === 3) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ');
        if (text)
          result.push({
            type: 'text',
            text,
            ...(marks.length ? { marks } : {}),
          });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const tag = element.localName;
      const latex = this.math(element);
      if (latex !== undefined) {
        result.push({ type: 'inlineMath', attrs: { latex } });
        continue;
      }
      if (skippedTags.has(tag)) {
        this.note(tag);
        continue;
      }
      if (unsupportedTags.has(tag)) {
        this.note(tag);
        const fallback =
          element.textContent?.trim() ||
          element.getAttribute('aria-label') ||
          `[未対応の ${tag}]`;
        result.push({ type: 'text', text: fallback });
        continue;
      }
      if (tag === 'br') {
        result.push({ type: 'hardBreak' });
        continue;
      }
      if (tag === 'img' || tag === 'svg') {
        const image = this.image(element);
        result.push(
          image
            ? { type: 'inlineImage', attrs: { ...this.attrs(), ...image } }
            : {
                type: 'text',
                text: `[画像: ${element.getAttribute('alt') || '読込不可'}]`,
              },
        );
        continue;
      }
      let added: Mark | undefined;
      if (tag === 'b' || tag === 'strong') added = { type: 'bold' };
      if (tag === 'i' || tag === 'em') added = { type: 'italic' };
      if (tag === 's' || tag === 'del' || tag === 'strike')
        added = { type: 'strike' };
      if (tag === 'code') added = { type: 'code' };
      if (tag === 'a') {
        const href = safeResourceUrl(
          element.getAttribute('href') ?? '',
          'link',
        );
        if (href) added = { type: 'link', attrs: { href } };
        else
          this.warnings.push(
            '安全でない、または空のリンク先を除去し、リンク文字を保持しました。',
          );
      }
      if (
        ![
          'span',
          'a',
          'b',
          'strong',
          'i',
          'em',
          's',
          'del',
          'strike',
          'code',
        ].includes(tag)
      )
        this.converted.add(tag);
      result.push(
        ...this.inline(
          element.childNodes,
          added && !marks.some((mark) => mark.type === added!.type)
            ? [...marks, added]
            : marks,
        ),
      );
      if (
        blockTags.has(tag) &&
        result.length &&
        result.at(-1)?.type !== 'hardBreak'
      )
        result.push({ type: 'hardBreak' });
    }
    return result;
  }

  blocks(nodes: Iterable<Node>): DocumentNode[] {
    const result: DocumentNode[] = [];
    let pending: Node[] = [];
    const flush = () => {
      const content = this.inline(pending);
      if (content.some((node) => node.type !== 'text' || node.text.trim()))
        result.push(this.paragraph(content));
      pending = [];
    };
    for (const node of nodes) {
      if (node.nodeType !== 1 || !blockTags.has((node as Element).localName)) {
        pending.push(node);
        continue;
      }
      flush();
      const element = node as Element;
      const tag = element.localName;
      const attrs = this.attrs();
      const latex = this.math(element);
      if (latex !== undefined) {
        result.push({ type: 'blockMath', attrs: { ...attrs, latex } });
        continue;
      }
      if (/^h[1-6]$/.test(tag)) {
        result.push({
          type: 'heading',
          attrs: {
            ...attrs,
            level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
          },
          content: this.inline(element.childNodes),
        });
      } else if (tag === 'p') {
        result.push(this.paragraph(this.inline(element.childNodes)));
      } else if (tag === 'ul' || tag === 'ol') {
        const items = [...element.children]
          .filter((child) => child.localName === 'li')
          .map((child) => {
            const content = this.blocks(child.childNodes);
            // Tiptap requires a leading paragraph even when HTML starts an item
            // with a heading, image or nested list. Preserve those blocks after it.
            if (content[0]?.type !== 'paragraph')
              content.unshift(this.paragraph());
            return {
              type: 'listItem' as const,
              attrs: this.attrs(),
              content,
            };
          });
        if (items.length)
          result.push(
            tag === 'ul'
              ? { type: 'bulletList', attrs, content: items }
              : {
                  type: 'orderedList',
                  attrs: {
                    ...attrs,
                    start: Math.max(
                      1,
                      Number.parseInt(element.getAttribute('start') ?? '1') ||
                        1,
                    ),
                  },
                  content: items,
                },
          );
        const other = [...element.childNodes].filter(
          (child) =>
            child.nodeType !== 1 || (child as Element).localName !== 'li',
        );
        result.push(...this.blocks(other));
      } else if (tag === 'blockquote') {
        const content = this.blocks(element.childNodes);
        result.push({
          type: 'blockquote',
          attrs,
          content: content.length ? content : [this.paragraph()],
        });
      } else if (tag === 'pre') {
        const text = element.textContent ?? '';
        result.push({
          type: 'codeBlock',
          attrs: { ...attrs, language: null },
          content: text ? [{ type: 'text', text }] : [],
        });
      } else if (tag === 'hr') result.push({ type: 'horizontalRule', attrs });
      else if (tag === 'table') result.push(...this.table(element));
      else if (tag === 'svg' || tag === 'img') {
        const image = this.image(element);
        result.push(
          image
            ? {
                type: 'figure',
                attrs: { ...attrs, ...image, width: 100, align: 'center' },
              }
            : this.paragraph([{ type: 'text', text: '[SVG画像: 読込不可]' }]),
        );
      } else result.push(...this.blocks(element.childNodes));
    }
    flush();
    return result;
  }

  private table(element: Element): DocumentNode[] {
    const rows = [...element.querySelectorAll('tr')].filter(
      (row) => row.closest('table') === element,
    );
    const content = rows.map((row) => ({
      type: 'tableRow' as const,
      attrs: this.attrs(),
      content: [...row.children]
        .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
        .map((cell) => ({
          type:
            cell.localName === 'th'
              ? ('tableHeader' as const)
              : ('tableCell' as const),
          attrs: {
            ...this.attrs(),
            align: null,
            colspan: Number(cell.getAttribute('colspan') ?? 1),
            rowspan: Number(cell.getAttribute('rowspan') ?? 1),
          },
          content: [this.paragraph(this.inline(cell.childNodes))],
        })),
    }));
    if (element.querySelector('table, ul, ol, pre'))
      this.warnings.push('表内の入れ子構造をセルの文章へ変換しました。');
    const table: TableNode = { type: 'table', attrs: this.attrs(), content };
    const caption = element.querySelector(':scope > caption');
    if (caption?.textContent) table.attrs.caption = caption.textContent;
    try {
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: [table],
      });
      return [table];
    } catch {
      this.warnings.push(
        '結合セルの構造が不正な表を行ごとの文章へ変換しました。元の表と照合してください。',
      );
      return [
        ...(caption?.textContent
          ? [
              this.paragraph([
                { type: 'text' as const, text: caption.textContent },
              ]),
            ]
          : []),
        ...rows.map((row) => this.paragraph(this.inline(row.childNodes))),
      ];
    }
  }

  finishWarnings(): string[] {
    if (this.removed.size)
      this.warnings.push(
        `実行・表示を再現しない要素: ${[...this.removed].map(([tag, count]) => `${tag} (${count})`).join(', ')}`,
      );
    if (this.converted.size)
      this.warnings.push(
        `文章へ変換した要素: ${[...this.converted].join(', ')}`,
      );
    return [...this.warnings, ...this.assets.warnings];
  }
}

/** Parse only into a detached, inert template. Source HTML is never mounted in the app. */
export function importHtml(
  source: string,
  sourceName = 'document.html',
): HtmlImportResult {
  if (source.length > maximumHtmlBytes)
    throw new Error('HTMLが150 MiBを超えています。');
  const inert = document.implementation.createHTMLDocument('');
  const template = inert.createElement('template');
  template.innerHTML = source;
  const root = template.content;
  const embedded = root.querySelectorAll(`[id="${editableHtmlId}"]`);
  const assets = new ImportAssets();
  try {
    if (embedded.length) {
      if (embedded.length !== 1)
        throw new Error('編集用HTMLの埋込データが重複しています。');
      return restoreEmbedded(embedded[0], assets);
    }
    if (new TextEncoder().encode(source).byteLength > maximumExternalHtmlBytes)
      throw new Error('外部HTMLは5 MiBまで取り込めます。');
    checkHtmlBudget(root);
    const converter = new HtmlConverter(assets);
    // Recognize common reveal.js and exported slide wrappers, keeping surrounding content.
    const slideCandidates = [
      ...root.querySelectorAll(
        '.slides section, .slide, .deck-slide, [data-slide]',
      ),
    ];
    const slides = slideCandidates.filter(
      (element) =>
        !slideCandidates.some(
          (other) => other !== element && element.contains(other),
        ),
    );
    const slideSet = new Set(slides);
    const children: DocumentNode[] = [];
    const append = (nodes: Node[]) => children.push(...converter.blocks(nodes));
    if (slides.length) {
      let pageStarted = false;
      const walk = (parent: { childNodes: NodeListOf<ChildNode> }) => {
        let pending: Node[] = [];
        const flush = () => {
          append(pending);
          pending = [];
        };
        for (const node of parent.childNodes) {
          if (node.nodeType === 1 && slideSet.has(node as Element)) {
            flush();
            if (pageStarted || children.length)
              children.push({
                type: 'slideBreak',
                attrs: { nodeId: createNodeId() },
              });
            append([...node.childNodes]);
            pageStarted = true;
          } else if (
            node.nodeType === 1 &&
            slides.some((slide) => (node as Element).contains(slide))
          ) {
            flush();
            walk(node as Element);
          } else pending.push(node);
        }
        flush();
      };
      walk(root);
      converter.warnings.push(
        `スライドの区切り ${slides.length} 件を検出しました。画面上の自動改ページは再現しません。`,
      );
    } else append([...root.childNodes]);
    if (!children.length)
      children.push({
        type: 'paragraph',
        attrs: { nodeId: createNodeId() },
        content: [],
      });
    const title =
      root.querySelector('title')?.textContent?.trim() ||
      root.querySelector('h1')?.textContent?.trim() ||
      sourceName.replace(/\.html?$/i, '');
    const document: DocumentData = {
      schemaVersion: 2,
      type: slides.length ? 'slide' : 'report',
      metadata: {
        title,
        theme: resolveDocumentTheme(slides.length ? 'slide' : 'report'),
      },
      children,
    };
    const htmlImport = summarize(
      document,
      'converted',
      converter.finishWarnings(),
    );
    document.metadata.preserved_content = [
      {
        id: createNodeId(),
        name: sourceName.slice(0, 1000),
        format: 'html',
        source,
      },
    ];
    htmlImport.warnings.push(
      '変換前のHTML原文を保持しました。プロパティから原文を確認・保存できます。外部リンク先のファイルは含みません。',
    );
    // The conversion report survives saves and subsequent editable HTML round trips.
    document.metadata.html_import = {
      source: sourceName,
      kind: htmlImport.kind,
      page_count: htmlImport.pageCount,
      warnings: htmlImport.warnings,
    };
    return {
      document: migrateDocumentData(document),
      assets: assets.urls,
      htmlImport,
    };
  } catch (error) {
    revokeAssetUrls(assets.urls);
    throw error;
  }
}
