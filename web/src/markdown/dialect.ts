import MarkdownIt from 'markdown-it';

export const canonicalHardBreakMarker = '{.kumi-br}';

function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (
    let index = position - 1;
    index >= 0 && source[index] === '\\';
    index -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function createMarkdownIt(): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
    breaks: false,
  });

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

      const contentStart = state.bMarks[startLine + 1] ?? maximum;
      const contentEnd = state.bMarks[nextLine];
      const token = state.push('math_block', 'math', 0);
      token.block = true;
      token.map = [startLine, nextLine + 1];
      token.markup = '$$';
      token.content = state.src
        .slice(contentStart, contentEnd)
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
