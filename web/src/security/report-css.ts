/**
 * Document-level CSS arrives inside files written by other people and is placed
 * in a <style> element. Only self-contained declarations are accepted: nothing
 * that loads a resource, leaves the style element or escapes its scope.
 */
export const maximumReportCssLength = 64 * 1024;

const forbidden: ReadonlyArray<readonly [string, string]> = [
  ['<', '「<」'],
  ['url(', 'url()'],
  ['src(', 'src()'],
  ['image-set(', 'image-set()'],
  ['image(', 'image()'],
  ['cross-fade(', 'cross-fade()'],
  ['element(', 'element()'],
  ['paint(', 'paint()'],
  ['expression(', 'expression()'],
  ['javascript:', 'javascript:'],
  ['-moz-binding', '-moz-binding'],
];

/** CSS escapes are decoded first, so `u\72l(` is recognized as `url(`. */
function decodeEscapes(source: string): string {
  return source.replace(
    /\\(?:([0-9a-f]{1,6})[ \t\n\f]?|([\s\S]))/gi,
    (_, hex: string | undefined, character: string | undefined) => {
      if (hex === undefined) return character === '\n' ? '' : (character ?? '');
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10ffff ? '�' : String.fromCodePoint(code);
    },
  );
}

/** Returns the reasons the style sheet is rejected; empty when it is acceptable. */
export function reportCssIssues(value: unknown): string[] {
  if (typeof value !== 'string') return ['文字列で指定してください。'];
  if (value.length > maximumReportCssLength)
    return [`${maximumReportCssLength / 1024} KiB以下にしてください。`];
  // oxlint-disable-next-line no-control-regex -- Control characters have no use in a style sheet.
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(value))
    return ['制御文字は使用できません。'];
  // Checked on the raw text, before comments and strings are set aside: the
  // HTML parser ends a style element at "</style" wherever it appears.
  if (value.includes('<')) return ['「<」は使用できません。'];
  const css = value.replace(/\r\n?|\f/g, '\n');
  const issues: string[] = [];
  // Strings and comments are removed before balancing; an unterminated one would
  // swallow the closing brace of the scope the style sheet is nested in.
  let structure = '';
  const closers: string[] = [];
  // What each open "{" holds. Declarations belong in style rules (and @page);
  // at the top level or directly inside @media and similar they would style
  // the scope element itself.
  const blocks: Array<'rule' | 'group' | 'declarations'> = [];
  // Text since the last "{", "}" or ";" at each block level.
  const pending: string[] = [''];
  const holdsRulesOnly = () => !blocks.length || blocks.at(-1) === 'group';
  for (let index = 0; index < css.length; index++) {
    const character = css[index];
    if (character === '\\') {
      // An escaped newline or end of input cannot be judged safely.
      if (index + 1 >= css.length) return ['末尾の「\\」は使用できません。'];
      structure += css.slice(index, index + 2);
      pending[pending.length - 1] += css.slice(index, index + 2);
      index++;
    } else if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end < 0) return ['コメントが閉じられていません。'];
      structure += ' ';
      index = end + 1;
    } else if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < css.length && css[end] !== character) {
        if (css[end] === '\n') return ['文字列が閉じられていません。'];
        end += css[end] === '\\' ? 2 : 1;
      }
      if (end >= css.length) return ['文字列が閉じられていません。'];
      structure += '""';
      pending[pending.length - 1] += '""';
      index = end;
    } else {
      const nested = closers.some((closer) => closer !== '}');
      if ('{[('.includes(character))
        closers.push({ '{': '}', '[': ']', '(': ')' }[character]!);
      else if ('}])'.includes(character) && closers.pop() !== character)
        return ['括弧の対応が正しくありません。'];
      if (nested || '[]()'.includes(character))
        pending[pending.length - 1] += character;
      else if (character === '{') {
        const prelude = pending[pending.length - 1].trim().toLowerCase();
        blocks.push(
          !prelude.startsWith('@')
            ? 'rule'
            : /^@(?:page|(?:top|bottom|left|right)-)/.test(prelude)
              ? 'declarations'
              : 'group',
        );
        pending[pending.length - 1] = '';
        pending.push('');
      } else if (character === '}') {
        if (blocks.at(-1) === 'group' && pending.at(-1)!.trim())
          return ['セレクターのない宣言は使用できません。'];
        blocks.pop();
        pending.pop();
        pending[pending.length - 1] = '';
      } else if (character === ';') {
        if (holdsRulesOnly()) return ['セレクターのない宣言は使用できません。'];
        pending[pending.length - 1] = '';
      } else pending[pending.length - 1] += character;
      structure += character;
    }
  }
  if (closers.length) return ['括弧が閉じられていません。'];
  if (pending[0].trim()) return ['セレクターのない宣言は使用できません。'];
  // Whitespace and comments cannot split these tokens in a way browsers accept,
  // but removing them only makes the check stricter.
  const decoded = decodeEscapes(structure).toLowerCase();
  const compact = decoded.replace(/\s+/g, '');
  // The editor preview confines the style sheet by nesting it in a scope rule.
  // `&` would let a selector name the scope's ancestors, and at-rules other
  // than these either define global names or choose their own scope.
  if (decoded.includes('&')) issues.push('「&」は使用できません。');
  // A selector that starts with a combinator is relative to the scope element
  // itself, so it could reach the scope's siblings. It is also not valid in a
  // style sheet on its own, where it stops the paginated layout.
  if (/(?:^|[{};,])\s*[+~>]/.test(decoded))
    issues.push('結合子（+ ~ >）で始まるセレクターは使用できません。');
  for (const [, name] of decoded.matchAll(/@([\w-]*)/g)) {
    if (
      !/^(?:media|supports|page|layer|container|(?:top|bottom|left|right)-[a-z-]+)$/.test(
        name,
      )
    )
      issues.push(`@${name} は使用できません。`);
  }
  // `behavior:` is the legacy IE property; `scroll-behavior` and others are fine.
  if (/(?:^|[;{}])behavior:/.test(compact))
    issues.push('behavior は使用できません。');
  for (const [token, label] of forbidden) {
    if (compact.includes(token)) issues.push(`${label} は使用できません。`);
  }
  return issues;
}

/** Validated CSS, or an empty string when it is missing or unacceptable. */
export function safeReportCss(value: unknown): string {
  return typeof value === 'string' && reportCssIssues(value).length === 0
    ? value
    : '';
}
