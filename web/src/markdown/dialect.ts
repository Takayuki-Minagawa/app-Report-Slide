import MarkdownIt from 'markdown-it';

import { canonicalHardBreakMarker, isEscaped } from './syntax';

export function createMarkdownIt(): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
  });

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
        /^\{(?:#|(?:label|caption|numbered|width|align)=)/.test(line);
      const pageBreak = /^:::\s+(pagebreak|slidebreak)\s*$/.exec(line);
      if (!attributes && !pageBreak) return false;
      if (silent) return true;
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
