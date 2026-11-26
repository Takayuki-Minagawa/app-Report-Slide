import katex from 'katex';
import { ImportedXmlComponent } from 'docx';

/**
 * LaTeX is converted to Word's own equation format (OMML) through the MathML
 * KaTeX already produces for the preview. The result is an equation Word can
 * edit, not a picture. Anything this converter does not know is reported by
 * throwing, so the caller can fall back and warn instead of writing a wrong
 * equation.
 */
const mathNamespace =
  'http://schemas.openxmlformats.org/officeDocument/2006/math';
const wordNamespace =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const naryOperators = new Set('∑∏∐∫∬∭∮∯∰⋀⋁⋂⋃⨀⨁⨂⨄⨆');
const integrals = new Set('∫∬∭∮∯∰');
/** Spacing and combining forms KaTeX writes for accents, as Word's combining marks. */
const accents: Record<string, string> = {
  '^': '\u0302',
  ˆ: '\u0302',
  '~': '\u0303',
  '˜': '\u0303',
  '´': '\u0301',
  '`': '\u0300',
  '˙': '\u0307',
  '¨': '\u0308',
  ˇ: '\u030c',
  '˘': '\u0306',
  '˚': '\u030a',
  '→': '\u20d7',
  '⃗': '\u20d7',
  '←': '\u20d6',
  '\u0302': '\u0302',
  '\u0303': '\u0303',
  '\u0307': '\u0307',
  '\u0308': '\u0308',
};
const bars = new Set(['¯', 'ˉ', '‾', '_', '\u0305', '\u0332', '―', '⎯']);

type Variant = {
  style?: 'p' | 'b' | 'bi' | 'i';
  script?: 'script' | 'fraktur' | 'double-struck' | 'sans-serif' | 'monospace';
};

function run(text: string, variant: Variant = {}, normal = false) {
  if (!text) return '';
  // m:scr precedes m:sty in the schema.
  const properties = normal
    ? '<m:rPr><m:nor/></m:rPr>'
    : variant.script || variant.style
      ? `<m:rPr>${variant.script ? `<m:scr m:val="${variant.script}"/>` : ''}${
          variant.style ? `<m:sty m:val="${variant.style}"/>` : ''
        }</m:rPr>`
      : '';
  return `<m:r>${properties}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

const elements = (node: Element) => [...node.children];
const text = (node: Element) => node.textContent ?? '';
const isOperator = (node: Element | undefined, set: Set<string>) =>
  node?.localName === 'mo' && set.has(text(node).trim());

function variant(node: Element): Variant {
  const value = node.getAttribute('mathvariant');
  switch (value) {
    case 'normal':
      return { style: 'p' };
    case 'bold':
      return { style: 'b' };
    case 'bold-italic':
      return { style: 'bi' };
    case 'italic':
      return { style: 'i' };
    case 'script':
    case 'fraktur':
    case 'double-struck':
    case 'monospace':
    case 'sans-serif':
      return { script: value, style: 'p' };
    case 'bold-script':
      return { script: 'script', style: 'b' };
    case 'bold-fraktur':
      return { script: 'fraktur', style: 'b' };
    case 'bold-sans-serif':
      return { script: 'sans-serif', style: 'b' };
    case 'sans-serif-italic':
      return { script: 'sans-serif', style: 'i' };
    case 'sans-serif-bold-italic':
      return { script: 'sans-serif', style: 'bi' };
    case null:
      // MathML renders a multi-letter identifier (sin, max) upright.
      return node.localName === 'mi' && Array.from(text(node)).length > 1
        ? { style: 'p' }
        : {};
    default:
      throw new Error(`Unsupported mathvariant: ${value}`);
  }
}

/** A token holds text only; markup inside it (a stacked operator) is not text. */
function token(node: Element): string {
  if (node.children.length) throw new Error('Unsupported nested token');
  return text(node);
}

function arg(name: string, content: string) {
  return `<m:${name}>${content}</m:${name}>`;
}

/** n-ary operators take the expression that follows them as their operand. */
function nary(
  operator: string,
  lower: string | undefined,
  upper: string | undefined,
  operand: string,
  limits: 'undOvr' | 'subSup',
) {
  return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(operator)}"/><m:limLoc m:val="${limits}"/>${
    lower === undefined ? '<m:subHide m:val="1"/>' : ''
  }${upper === undefined ? '<m:supHide m:val="1"/>' : ''}</m:naryPr>${arg('sub', lower ?? '')}${arg('sup', upper ?? '')}${arg('e', operand)}</m:nary>`;
}

function naryParts(node: Element):
  | {
      operator: string;
      lower?: string;
      upper?: string;
      limits: 'undOvr' | 'subSup';
    }
  | undefined {
  if (isOperator(node, naryOperators))
    return {
      operator: text(node).trim(),
      limits: integrals.has(text(node).trim()) ? 'subSup' : 'undOvr',
    };
  const [base, first, second] = elements(node);
  if (!isOperator(base, naryOperators)) return undefined;
  const operator = text(base).trim();
  const limits =
    node.localName.startsWith('munder') || node.localName === 'mover'
      ? 'undOvr'
      : 'subSup';
  switch (node.localName) {
    case 'munder':
    case 'msub':
      return { operator, lower: convert(first), limits };
    case 'mover':
    case 'msup':
      return { operator, upper: convert(first), limits };
    case 'munderover':
    case 'msubsup':
      return {
        operator,
        lower: convert(first),
        upper: convert(second),
        limits,
      };
  }
  return undefined;
}

function row(nodes: Element[]): string {
  // \left( ... \right) arrives as a row bounded by fence operators; KaTeX
  // leaves out the invisible side of \left. or \right. altogether.
  const fence = (node: Element | undefined) =>
    node?.localName === 'mo' && node.getAttribute('fence') === 'true';
  const opens = nodes.length >= 2 && fence(nodes[0]);
  const closes = nodes.length >= 2 && fence(nodes.at(-1));
  if (opens || closes) {
    return `<m:d><m:dPr><m:begChr m:val="${opens ? escapeXml(text(nodes[0]).trim()) : ''}"/><m:endChr m:val="${closes ? escapeXml(text(nodes.at(-1)!).trim()) : ''}"/></m:dPr>${arg('e', row(nodes.slice(opens ? 1 : 0, closes ? -1 : undefined)))}</m:d>`;
  }
  let result = '';
  for (let index = 0; index < nodes.length; index++) {
    const parts = naryParts(nodes[index]);
    if (parts) {
      const operand = nodes[index + 1];
      result += nary(
        parts.operator,
        parts.lower,
        parts.upper,
        operand ? convert(operand) : '',
        parts.limits,
      );
      if (operand) index++;
    } else result += convert(nodes[index]);
  }
  return result;
}

function convert(node: Element): string {
  const children = elements(node);
  switch (node.localName) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
      return row(children);
    case 'semantics':
      return row(
        children.filter((child) => !child.localName.startsWith('annotation')),
      );
    case 'mi':
    case 'mn':
    case 'mo':
      return run(token(node), variant(node));
    case 'mtext':
      // KaTeX writes negative space as a space with an invisible separator.
      return token(node).includes('\u2063') ? '' : run(token(node), {}, true);
    case 'mspace':
      // A line break inside one equation has no single-equation equivalent.
      if (node.getAttribute('linebreak'))
        throw new Error('Unsupported line break');
      // Negative space only tightens; it must not become a visible gap.
      return (node.getAttribute('width') ?? '').trim().startsWith('-')
        ? ''
        : run(' ', {}, true);
    case 'mfrac':
      return `<m:f>${
        /^0(?:[a-z%]*)$/.test(node.getAttribute('linethickness') ?? '')
          ? '<m:fPr><m:type m:val="noBar"/></m:fPr>'
          : ''
      }${arg('num', convert(children[0]))}${arg('den', convert(children[1]))}</m:f>`;
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${arg('e', row(children))}</m:rad>`;
    case 'mroot':
      return `<m:rad>${arg('deg', convert(children[1]))}${arg('e', convert(children[0]))}</m:rad>`;
    case 'msub':
      return `<m:sSub>${arg('e', convert(children[0]))}${arg('sub', convert(children[1]))}</m:sSub>`;
    case 'msup':
      return `<m:sSup>${arg('e', convert(children[0]))}${arg('sup', convert(children[1]))}</m:sSup>`;
    case 'msubsup':
      return `<m:sSubSup>${arg('e', convert(children[0]))}${arg('sub', convert(children[1]))}${arg('sup', convert(children[2]))}</m:sSubSup>`;
    case 'mmultiscripts': {
      // KaTeX writes prescripts as: base, <mprescripts/>, sub, sup.
      const [base, marker, sub, sup] = children;
      if (marker?.localName !== 'mprescripts' || children.length !== 4)
        throw new Error('Unsupported mmultiscripts');
      const empty = (entry: Element) =>
        entry.localName === 'none' ? '' : convert(entry);
      return `<m:sPre>${arg('sub', empty(sub))}${arg('sup', empty(sup))}${arg('e', convert(base))}</m:sPre>`;
    }
    case 'mover':
    case 'munder': {
      const [base, mark] = children;
      const symbol = text(mark).trim();
      const over = node.localName === 'mover';
      if (mark.localName === 'mo' && bars.has(symbol))
        return `<m:bar><m:barPr><m:pos m:val="${over ? 'top' : 'bot'}"/></m:barPr>${arg('e', convert(base))}</m:bar>`;
      if (over && mark.localName === 'mo' && accents[symbol])
        return `<m:acc><m:accPr><m:chr m:val="${accents[symbol]}"/></m:accPr>${arg('e', convert(base))}</m:acc>`;
      if (mark.localName === 'mo' && (symbol === '⏞' || symbol === '⏟'))
        return `<m:groupChr><m:groupChrPr><m:chr m:val="${symbol}"/><m:pos m:val="${over ? 'top' : 'bot'}"/></m:groupChrPr>${arg('e', convert(base))}</m:groupChr>`;
      return over
        ? `<m:limUpp>${arg('e', convert(base))}${arg('lim', convert(mark))}</m:limUpp>`
        : `<m:limLow>${arg('e', convert(base))}${arg('lim', convert(mark))}</m:limLow>`;
    }
    case 'munderover':
      return `<m:limUpp>${arg('e', `<m:limLow>${arg('e', convert(children[0]))}${arg('lim', convert(children[1]))}</m:limLow>`)}${arg('lim', convert(children[2]))}</m:limUpp>`;
    case 'mtable': {
      const rows = children.filter((child) => child.localName === 'mtr');
      const count = Math.max(1, ...rows.map((entry) => elements(entry).length));
      const alignments = (node.getAttribute('columnalign') ?? '')
        .split(/\s+/)
        .filter(Boolean);
      const columns = Array.from({ length: count }, (_, index) => {
        const alignment =
          alignments[Math.min(index, alignments.length - 1)] ?? 'center';
        return `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${
          alignment === 'left' || alignment === 'right' ? alignment : 'center'
        }"/></m:mcPr></m:mc>`;
      }).join('');
      return `<m:m><m:mPr><m:mcs>${columns}</m:mcs></m:mPr>${rows
        .map((entry) => {
          const cells = elements(entry);
          return `<m:mr>${Array.from({ length: count }, (_, index) =>
            arg('e', cells[index] ? row(elements(cells[index])) : ''),
          ).join('')}</m:mr>`;
        })
        .join('')}</m:m>`;
    }
    case 'mphantom':
      return `<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr>${arg('e', row(children))}</m:phant>`;
    case 'menclose':
      // Only a plain frame; a strike-through would otherwise turn into a box.
      if (!/^(?:box|roundedbox|)$/.test(node.getAttribute('notation') ?? ''))
        throw new Error('Unsupported enclosure');
      return `<m:borderBox>${arg('e', row(children))}</m:borderBox>`;
    case 'merror':
      throw new Error('Invalid LaTeX');
    default:
      throw new Error(`Unsupported MathML element: ${node.localName}`);
  }
}

const unsupportedColor = '#fe0b0c';

/** OMML for one equation, without the surrounding paragraph element. */
export function latexToOmml(latex: string, display: boolean): string {
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: true,
    trust: false,
    strict: 'ignore',
    // Commands KaTeX declines (untrusted links, HTML classes) are drawn as
    // their own name in this colour; such an equation is not converted.
    errorColor: unsupportedColor,
    output: 'mathml',
  });
  if (html.includes(unsupportedColor)) throw new Error('Unsupported command');
  // An equation tag would become a matrix cell rather than a number.
  if (/\\tag\b/.test(latex)) throw new Error('Unsupported tag');
  const start = html.indexOf('<math');
  const end = html.lastIndexOf('</math>');
  if (start < 0 || end < 0) throw new Error('KaTeX produced no MathML');
  const parsed = new DOMParser().parseFromString(
    html.slice(start, end + '</math>'.length),
    'application/xml',
  );
  if (parsed.getElementsByTagName('parsererror').length)
    throw new Error('KaTeX produced MathML that is not XML');
  const body = convert(parsed.documentElement);
  if (!body) throw new Error('Empty equation');
  return `<m:oMath xmlns:m="${mathNamespace}" xmlns:w="${wordNamespace}">${body}</m:oMath>`;
}

/**
 * A paragraph child. `ownParagraph` wraps a display equation as the only
 * content of its paragraph; without it the equation can share a line with
 * tabs and its number.
 */
export function mathComponent(
  latex: string,
  display: boolean,
  ownParagraph = display,
) {
  const equation = latexToOmml(latex, display);
  const parsed = ImportedXmlComponent.fromXmlString(
    ownParagraph
      ? `<m:oMathPara xmlns:m="${mathNamespace}" xmlns:w="${wordNamespace}">${equation.replace(
          / xmlns:m="[^"]+" xmlns:w="[^"]+"/,
          '',
        )}</m:oMathPara>`
      : equation,
  );
  // The parser returns an unnamed document node around the equation element.
  const [element] = (parsed as unknown as { root: unknown[] }).root;
  if (!(element instanceof ImportedXmlComponent))
    throw new Error('Equation XML could not be imported');
  return element;
}
