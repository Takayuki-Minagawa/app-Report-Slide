import MarkdownIt from 'markdown-it';

import { canonicalHardBreakMarker, isEscaped } from './syntax';

interface FootnoteDefinition {
  source: string;
  /** Zero-based line in the parsed body. */
  line: number;
  /** Plain text, resolved once however many times the note is referenced. */
  text?: string;
  used: boolean;
}

interface KumiEnvironment {
  /** Reference-style footnote definitions collected while parsing one document. */
  kumiFootnotes?: Map<string, FootnoteDefinition>;
  /** Lines of definitions that repeat an earlier ID and are therefore not read. */
  kumiDuplicateFootnotes?: Array<{ id: string; line: number }>;
  /** Set while reading a footnote's label or text, where footnotes do not nest. */
  kumiFootnoteText?: boolean;
}

const footnoteId = String.raw`[^\s\]]{1,128}`;
const footnoteDefinition = new RegExp(
  String.raw`^\[\^(${footnoteId})\]:[ \t]+(\S.*)$`,
);
const footnoteReference = new RegExp(String.raw`^\[\^(${footnoteId})\]`);
/** The content of a `[@label]` cross-reference. */
const referenceContent = /^@[A-Za-z][A-Za-z0-9:._-]{0,127}$/;

/**
 * Footnotes are plain text: keep the characters and drop inline formatting.
 * A separate environment stops a note from expanding another note (or itself).
 */
function footnoteText(markdown: MarkdownIt, source: string): string {
  const tokens: Parameters<MarkdownIt['inline']['parse']>[3] = [];
  const env: KumiEnvironment = { kumiFootnoteText: true };
  markdown.inline.parse(source, markdown, env, tokens);
  return (
    tokens
      .map((token) =>
        token.type === 'softbreak' || token.type === 'hardbreak'
          ? ' '
          : token.content,
      )
      .join('')
      // An entity such as &#10; can still carry a line break into the text.
      .replace(/[\r\n]+/g, ' ')
      .trim()
  );
}

/** Definitions that produced no footnote: never referenced, or a repeated ID. */
export function ignoredFootnoteDefinitions(
  env: object,
): Array<{ id: string; line: number }> {
  const { kumiFootnotes, kumiDuplicateFootnotes = [] } = env as KumiEnvironment;
  return [
    ...[...(kumiFootnotes ?? [])]
      .filter(([, definition]) => !definition.used)
      .map(([id, definition]) => ({ id, line: definition.line })),
    ...kumiDuplicateFootnotes,
  ].sort((a, b) => a.line - b.line);
}

export function createMarkdownIt(): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
  });

  // Pandoc inline footnote: text^[note]. KUMI saves every footnote this way.
  markdown.inline.ruler.after('image', 'kumi_footnote', (state, silent) => {
    const env = state.env as KumiEnvironment;
    const start = state.pos;
    if (
      state.src.charCodeAt(start) !== 0x5e /* ^ */ ||
      state.src.charCodeAt(start + 1) !== 0x5b /* [ */ ||
      env.kumiFootnoteText
    )
      return false;
    // Inner "^[" count as plain brackets here, which keeps the scan linear.
    env.kumiFootnoteText = true;
    let end: number;
    try {
      end = state.md.helpers.parseLinkLabel(state, start + 1);
    } finally {
      env.kumiFootnoteText = false;
    }
    if (end < 0) return false;
    const inner = state.src.slice(start + 2, end);
    // Documents saved before footnotes existed may hold a literal "^" directly
    // before a link or a [@reference]; those keep their meaning.
    if (
      state.src.charCodeAt(end + 1) === 0x28 /* ( */ ||
      referenceContent.test(inner)
    )
      return false;
    if (silent) {
      if (!inner.trim()) return false;
    } else {
      const text = footnoteText(state.md, inner);
      if (!text) return false;
      state.push('kumi_footnote', '', 0).content = text;
    }
    state.pos = end + 1;
    return true;
  });

  // GitHub-style [^id] with a "[^id]: note" definition is read as the same node.
  markdown.inline.ruler.before('link', 'kumi_footnote_ref', (state, silent) => {
    const env = state.env as KumiEnvironment;
    if (
      state.src.charCodeAt(state.pos) !== 0x5b /* [ */ ||
      state.src.charCodeAt(state.pos + 1) !== 0x5e /* ^ */ ||
      !env.kumiFootnotes
    )
      return false;
    const match = footnoteReference.exec(
      state.src.slice(state.pos, state.pos + 132),
    );
    const definition = match && env.kumiFootnotes.get(match[1]);
    if (!match || !definition) return false;
    definition.text ??= footnoteText(state.md, definition.source);
    if (!definition.text) return false;
    if (!silent) {
      definition.used = true;
      state.push('kumi_footnote', '', 0).content = definition.text;
    }
    state.pos += match[0].length;
    return true;
  });

  markdown.block.ruler.before(
    'reference',
    'kumi_footnote_definition',
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const match = footnoteDefinition.exec(
        state.src
          .slice(
            state.bMarks[startLine] + state.tShift[startLine],
            state.eMarks[startLine],
          )
          .trim(),
      );
      if (!match) return false;
      if (silent) return true;
      // Continue like a paragraph: up to a blank line or anything that may
      // interrupt a paragraph, so a following block is never absorbed.
      const terminators = state.md.block.ruler.getRules('paragraph');
      const parentType = state.parentType;
      state.parentType = 'paragraph';
      let nextLine = startLine + 1;
      for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine += 1) {
        if (state.sCount[nextLine] - state.blkIndent > 3) continue;
        if (state.sCount[nextLine] < 0) continue;
        const line = nextLine;
        if (terminators.some((rule) => rule(state, line, endLine, true))) break;
      }
      state.parentType = parentType;
      const continuation = state
        .getLines(startLine + 1, nextLine, state.blkIndent, false)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const env = state.env as KumiEnvironment;
      env.kumiFootnotes ??= new Map();
      if (env.kumiFootnotes.has(match[1]))
        (env.kumiDuplicateFootnotes ??= []).push({
          id: match[1],
          line: startLine,
        });
      else
        env.kumiFootnotes.set(match[1], {
          source: [match[2], ...continuation].join(' '),
          line: startLine,
          used: false,
        });
      state.line = nextLine;
      return true;
    },
    { alt: ['paragraph', 'reference'] },
  );

  markdown.inline.ruler.after('link', 'kumi_reference', (state, silent) => {
    // Link-label scanning uses silent mode; do not pretend a reference is a nested link.
    if (silent) return false;
    // markdown-it 14 exposes linkLevel at runtime; @types has not declared it.
    if ((state as typeof state & { linkLevel: number }).linkLevel > 0)
      return false;
    const match = /^\[@([A-Za-z][A-Za-z0-9:._-]{0,127})\]/.exec(
      state.src.slice(state.pos),
    );
    if (!match) return false;
    if (!silent) state.push('kumi_reference', '', 0).content = match[1];
    state.pos += match[0].length;
    return true;
  });

  markdown.block.ruler.before(
    'fence',
    'kumi_structure',
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const lineAt = (index: number) =>
        state.src
          .slice(state.bMarks[index] + state.tShift[index], state.eMarks[index])
          .trim();
      const line = lineAt(startLine);
      const attributes =
        /^\{(?:#|(?:label|caption|numbered|width|align|slide_layout|text_ruler)=)/.test(
          line,
        );
      const pageBreak = /^:::\s+(pagebreak|slidebreak)\s*$/.exec(line);
      const advancedTable = /^:::\s+kumi-table\s*$/.test(line);
      const advancedChart = /^:::\s+kumi-chart\s*$/.test(line);
      const notes = /^:::\s+notes\s*$/.test(line);
      if (
        !attributes &&
        !pageBreak &&
        !advancedTable &&
        !advancedChart &&
        !notes
      )
        return false;
      if (silent) return true;
      if (notes) {
        let closingLine = startLine + 1;
        while (closingLine < endLine && lineAt(closingLine) !== ':::') {
          closingLine += 1;
        }
        if (closingLine >= endLine) {
          const token = state.push('kumi_invalid_notes', '', 0);
          token.map = [startLine, endLine];
          token.block = true;
          state.line = endLine;
          return true;
        }
        const open = state.push('kumi_notes_open', 'aside', 1);
        open.map = [startLine, closingLine + 1];
        open.block = true;
        const lineMax = state.lineMax;
        state.lineMax = closingLine;
        state.md.block.tokenize(state, startLine + 1, closingLine);
        state.lineMax = lineMax;
        state.push('kumi_notes_close', 'aside', -1).block = true;
        state.line = closingLine + 1;
        return true;
      }
      if (advancedTable || advancedChart) {
        let closingLine = startLine + 1;
        while (closingLine < endLine && lineAt(closingLine) !== ':::') {
          closingLine += 1;
        }
        const closed = closingLine < endLine;
        const token = state.push(
          closed
            ? advancedChart
              ? 'kumi_advanced_chart'
              : 'kumi_advanced_table'
            : advancedChart
              ? 'kumi_invalid_advanced_chart'
              : 'kumi_invalid_advanced_table',
          '',
          0,
        );
        token.content = closed
          ? state
              .getLines(startLine + 1, closingLine, state.blkIndent, false)
              .replace(/\n$/, '')
          : '';
        token.map = [startLine, closed ? closingLine + 1 : endLine];
        token.block = true;
        state.line = token.map[1];
        return true;
      }
      const closed =
        pageBreak && startLine + 1 < endLine && lineAt(startLine + 1) === ':::';
      const token = state.push(
        attributes
          ? 'kumi_attributes'
          : closed
            ? 'kumi_break'
            : 'kumi_invalid_break',
        '',
        0,
      );
      token.content = attributes ? line : pageBreak![1];
      token.map = [startLine, startLine + (closed ? 2 : 1)];
      token.block = true;
      state.line = token.map[1];
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  markdown.inline.ruler.after('escape', 'kumi_hard_break', (state, silent) => {
    const start = state.pos;
    if (
      !state.src.startsWith(canonicalHardBreakMarker, start) ||
      isEscaped(state.src, start)
    ) {
      return false;
    }
    if (!silent) {
      const token = state.push('hardbreak', 'br', 0);
      token.markup = canonicalHardBreakMarker;
    }
    state.pos = start + canonicalHardBreakMarker.length;
    return true;
  });

  markdown.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    if (
      state.src[start] !== '$' ||
      state.src[start + 1] === '$' ||
      isEscaped(state.src, start)
    ) {
      return false;
    }

    const nextCharacter = state.src[start + 1];
    if (!nextCharacter || /\s/.test(nextCharacter)) {
      return false;
    }

    let end = start + 1;
    while (end < state.posMax) {
      end = state.src.indexOf('$', end);
      if (end < 0 || end >= state.posMax) return false;
      if (!isEscaped(state.src, end)) break;
      end += 1;
    }

    if (
      end <= start + 1 ||
      /\s/.test(state.src[end - 1]) ||
      state.src[end + 1] === '$'
    ) {
      return false;
    }

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = state.src.slice(start + 1, end);
      token.markup = '$';
    }
    state.pos = end + 1;
    return true;
  });

  markdown.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const maximum = state.eMarks[startLine];
      const line = state.src.slice(start, maximum).trim();

      if (!line.startsWith('$$')) return false;

      if (line.length > 4 && line.endsWith('$$')) {
        if (silent) return true;
        const token = state.push('math_block', 'math', 0);
        token.block = true;
        token.map = [startLine, startLine + 1];
        token.markup = '$$';
        token.content = line.slice(2, -2).trim();
        state.line = startLine + 1;
        return true;
      }

      if (line !== '$$') return false;

      let nextLine = startLine + 1;
      while (nextLine < endLine) {
        const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const nextMaximum = state.eMarks[nextLine];
        if (state.src.slice(nextStart, nextMaximum).trim() === '$$') break;
        nextLine += 1;
      }

      if (nextLine >= endLine) return false;
      if (silent) return true;

      const token = state.push('math_block', 'math', 0);
      token.block = true;
      token.map = [startLine, nextLine + 1];
      token.markup = '$$';
      token.content = state
        .getLines(startLine + 1, nextLine, state.blkIndent, false)
        .replace(/\n$/, '');
      state.line = nextLine + 1;
      return true;
    },
    {
      alt: ['paragraph', 'reference', 'blockquote', 'list'],
    },
  );

  return markdown;
}
