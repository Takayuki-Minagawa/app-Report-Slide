import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';

const execute = promisify(execFile);
const compact = (text) => text.replace(/\s+/g, '');

/** LibreOffice from KUMI_SOFFICE, PATH or the usual macOS location. */
export async function findOffice() {
  const candidates = [
    process.env.KUMI_SOFFICE,
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .flatMap((directory) => [
        join(directory, 'soffice'),
        join(directory, 'libreoffice'),
      ]),
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try the next location */
    }
  }
  return undefined;
}

/** Text of every page, as lines read top to bottom. */
async function pdfLines(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const rows = new Map();
      for (const item of content.items) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]);
        const key = [...rows.keys()].find((row) => Math.abs(row - y) <= 2) ?? y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push({ x: item.transform[4], text: item.str });
      }
      pages.push(
        [...rows.entries()]
          .sort(([a], [b]) => b - a)
          .map(([, items]) =>
            items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(''),
          ),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "- {n} -" → a pattern capturing the page number, ignoring spaces. */
function numberPattern(format) {
  return compact(format)
    .split(/(\{n\}|\{total\})/)
    .map((part) =>
      part === '{n}'
        ? '(\\d+)'
        : part === '{total}'
          ? '\\d+'
          : escapeRegExp(part),
    )
    .join('');
}

/**
 * Checks a Word document without Word: numbers and widths from its XML, and the
 * contents page numbers after LibreOffice has laid the document out. Line and
 * page breaks differ a little between Word and LibreOffice, so page positions
 * are compared within the converted document only, never with the HTML or PDF.
 */
export async function checkDocx(bytes, document, api, { locale = 'ja' } = {}) {
  const files = unzipSync(new Uint8Array(bytes));
  const xml = new JSDOM(strFromU8(files['word/document.xml']), {
    contentType: 'text/xml',
  }).window.document;
  const all = (root, name) => [...root.getElementsByTagName(name)];
  // Caption and equation paragraphs with their spaces, found by their style,
  // so body text that begins with a reference is not mistaken for a caption.
  const styled = (style) =>
    all(xml, 'w:p')
      .filter(
        (paragraph) =>
          paragraph
            .getElementsByTagName('w:pStyle')[0]
            ?.getAttribute('w:val') === style,
      )
      .map((paragraph) =>
        [...all(paragraph, 'w:t'), ...all(paragraph, 'm:t')]
          .sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1))
          .map((node) => node.textContent)
          .join(''),
      );
  const captionParagraphs = styled('Caption');
  const equationParagraphs = styled('KumiEquation');
  const settings = api.resolveReportSettings(document.metadata);
  const analysis = api.analyzeDocument(document);
  const issues = [];
  const separator = settings.caption_separator ?? ' — ';

  // 1. Caption numbers and references are the ones KUMI shows.
  const captions = {};
  for (const [type, key] of [
    ['figure', 'figures'],
    ['table', 'tables'],
    ['blockMath', 'equations'],
  ]) {
    const targets = [...analysis.targets.values()].filter(
      (target) => target.type === type && target.number,
    );
    const missing = targets
      .map((target) =>
        type === 'blockMath'
          ? `(${target.number})`
          : api.formatSemanticReference(target, locale),
      )
      .filter(
        (label) =>
          !(type === 'blockMath'
            ? equationParagraphs.some((paragraph) => paragraph.endsWith(label))
            : captionParagraphs.some(
                (paragraph) =>
                  // The whole label: "表 1" alone or followed by the configured
                  // separator, so "表 10" and "表 1.2" do not stand in for it.
                  paragraph === label ||
                  paragraph.startsWith(label + separator),
              )),
      );
    captions[key] = {
      expected: targets.length,
      last: targets.at(-1)?.number ?? null,
      missing,
    };
    for (const label of missing)
      issues.push({ code: 'caption-number', detail: label });
  }
  // References are compared one by one, in reading order: each must point at
  // the bookmark of its target and show the text KUMI shows.
  const anchors = new Map(
    [...analysis.targets.keys()].map((id, index) => [id, `kumi_${index + 1}`]),
  );
  const expectedReferences = [];
  // A reference without a target is printed as its raw label in every output.
  const unresolved = [];
  const collect = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type === 'reference') {
        const target = analysis.labels.get(node.attrs.target);
        if (!target) unresolved.push(node.attrs.target);
        else
          expectedReferences.push({
            anchor: anchors.get(target.nodeId),
            text: api.formatSemanticReference(target, locale),
          });
      }
      if (node.type !== 'speakerNotes') collect(node.content);
    }
  };
  collect(document.children);
  const inContents = (node) => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (parent.nodeName === 'w:sdt') return true;
      if (parent.nodeName === 'w:p')
        return /^TOC\d$/.test(
          parent.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ??
            '',
        );
    }
    return false;
  };
  const actualReferences = [
    ...all(xml, 'w:hyperlink')
      .filter((link) => link.hasAttribute('w:anchor') && !inContents(link))
      .map((link) => ({
        node: link,
        anchor: link.getAttribute('w:anchor'),
        text: link.textContent,
        field: false,
      })),
    ...all(xml, 'w:fldSimple')
      .filter((field) => /^\s*REF\s/.test(field.getAttribute('w:instr') ?? ''))
      .map((field) => ({
        node: field,
        anchor: field.getAttribute('w:instr').trim().split(/\s+/)[1],
        text: field.textContent,
        field: true,
      })),
  ].sort((a, b) => (a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1));
  const wrongReferences = [];
  for (
    let index = 0;
    index < Math.max(expectedReferences.length, actualReferences.length);
    index++
  ) {
    const expected = expectedReferences[index];
    const actual = actualReferences[index];
    const matches =
      expected &&
      actual &&
      expected.anchor === actual.anchor &&
      // A field may hold only the number, with its label as ordinary text.
      (expected.text === actual.text ||
        (actual.field && actual.text && expected.text.endsWith(actual.text)));
    if (!matches)
      wrongReferences.push({
        index: index + 1,
        expected: expected?.text ?? null,
        found: actual?.text ?? null,
      });
  }
  for (const entry of wrongReferences)
    issues.push({ code: 'reference', detail: entry });
  for (const label of unresolved)
    issues.push({ code: 'unresolved-reference', detail: label });

  // 2. Nothing is wider than the text area.
  const emuPerTwip = 635;
  const sections = all(xml, 'w:sectPr');
  const size = sections.at(-1)?.getElementsByTagName('w:pgSz')[0];
  const margin = sections.at(-1)?.getElementsByTagName('w:pgMar')[0];
  const textWidth =
    Number(size?.getAttribute('w:w')) -
    Number(margin?.getAttribute('w:left')) -
    Number(margin?.getAttribute('w:right'));
  const wide = [];
  all(xml, 'w:tbl').forEach((table, index) => {
    // Nested tables are measured against their cell by Word; check top level.
    if (table.parentNode?.nodeName !== 'w:body') return;
    const grid = [...table.childNodes].find(
      (node) => node.nodeName === 'w:tblGrid',
    );
    const width =
      all(grid ?? table, 'w:gridCol').reduce(
        (sum, column) => sum + Number(column.getAttribute('w:w')),
        0,
      ) +
      Number(
        table.getElementsByTagName('w:tblInd')[0]?.getAttribute('w:w') ?? 0,
      );
    if (width > textWidth + 20)
      wide.push({ kind: 'table', index: index + 1, twips: width });
  });
  all(xml, 'wp:extent').forEach((extent, index) => {
    const width = Number(extent.getAttribute('cx')) / emuPerTwip;
    if (width > textWidth + 20)
      wide.push({ kind: 'image', index: index + 1, twips: Math.round(width) });
  });
  for (const entry of wide) issues.push({ code: 'width', detail: entry });

  // 3. Contents page numbers agree with the pages of the headings.
  const contents = { status: 'skipped', entries: [] };
  const outline =
    document.metadata.toc === true ? api.reportOutline(document, analysis) : [];
  const office = await findOffice();
  let converter = null;
  let pageCount = null;
  if (!settings.toc_page_numbers || !outline.length)
    contents.reason = 'The document has no contents page numbers.';
  else if (!office)
    contents.reason =
      'LibreOffice (soffice) was not found. Install it or set KUMI_SOFFICE.';
  else {
    const directory = await mkdtemp(join(tmpdir(), 'kumi-docx-check-'));
    try {
      await writeFile(join(directory, 'report.docx'), bytes);
      await execute(
        office,
        [
          // An own profile: no clash with a running LibreOffice, nothing kept.
          `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          directory,
          join(directory, 'report.docx'),
        ],
        { timeout: 180_000 },
      );
      converter = (
        await execute(office, ['--version'], { timeout: 30_000 }).catch(() => ({
          stdout: 'LibreOffice',
        }))
      ).stdout.trim();
      const pages = await pdfLines(
        await readFile(join(directory, 'report.pdf')),
      );
      pageCount = pages.length;
      const tocNumber = new RegExp(
        `${numberPattern(settings.toc_page_number_format)}$`,
      );
      const footer = new RegExp(
        `^${numberPattern(settings.page_number_format)}$`,
      );
      const printedPage = (lines) => {
        for (const line of lines.toReversed()) {
          const match = footer.exec(compact(line));
          if (match) return Number(match[1]);
        }
        return null;
      };
      let cursor = 0;
      for (const target of outline) {
        const title = compact(
          `${target.number ? `${api.formatHeadingNumber(target, locale)} ` : ''}${target.title}`,
        );
        const entry = {
          title: `${target.number ?? ''} ${target.title}`.trim(),
        };
        // The contents line: the title, a leader, then the formatted number.
        let contentsPage = -1;
        search: for (let index = cursor; index < pages.length; index++) {
          for (const line of pages[index]) {
            const value = compact(line);
            if (!value.startsWith(title) || value === title) continue;
            const rest = value.slice(title.length).replace(/^[.…・·]+/, '');
            const match = tocNumber.exec(rest);
            if (match && match.index === 0) {
              entry.contents = Number(match[1]);
              contentsPage = index;
              break search;
            }
          }
        }
        // The heading itself: a line of its own, after the contents.
        for (
          let index = Math.max(contentsPage, 0);
          index < pages.length;
          index++
        ) {
          if (pages[index].some((line) => compact(line) === title)) {
            entry.heading = printedPage(pages[index]);
            break;
          }
        }
        if (contentsPage >= 0) cursor = contentsPage;
        contents.entries.push(entry);
      }
      const unread = contents.entries.filter(
        (entry) => entry.contents === undefined || entry.heading == null,
      );
      const wrong = contents.entries.filter(
        (entry) =>
          entry.contents !== undefined &&
          entry.heading != null &&
          entry.contents !== entry.heading,
      );
      if (wrong.length) {
        contents.status = 'fail';
        for (const entry of wrong)
          issues.push({ code: 'contents-page', detail: entry });
      } else if (unread.length) {
        // A Word TOC field is not refreshed by LibreOffice; only Word can tell.
        contents.status = 'unverified';
        contents.reason = settings.word_fields
          ? 'The contents are a Word field, which LibreOffice does not refresh. Update the fields in Word.'
          : 'Some contents lines or headings could not be read from the converted PDF.';
      } else contents.status = 'pass';
    } catch (error) {
      contents.status = 'unverified';
      contents.reason = `The document could not be converted or read: ${error.message}`;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return {
    schemaVersion: 1,
    status: issues.length
      ? 'fail'
      : contents.status === 'unverified'
        ? 'unverified'
        : 'pass',
    converter,
    pages: pageCount,
    textWidthTwips: textWidth,
    captions,
    references: {
      expected: expectedReferences.length,
      found: actualReferences.length,
      wrong: wrongReferences,
      unresolved,
    },
    wide,
    contents,
    issues,
  };
}
