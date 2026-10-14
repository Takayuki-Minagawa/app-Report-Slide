import { sanitizeSvgSource } from '../security/svg-source';
import { createNodeId } from './model';
import {
  diagramSchema,
  type Diagram,
  type DiagramShape,
  type DiagramEndpoint,
} from './diagram';

export interface SvgConversion {
  diagram: Diagram;
  previewSource: string;
  editableParts: number;
  retainedParts: number;
  warnings: string[];
}
const ns = 'http://www.w3.org/2000/svg';
const serializer = () => new XMLSerializer();
const round = (value: number) => Math.round(value * 100000) / 100000;
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transform(value: string | null): Matrix | undefined {
  if (!value) return identity;
  let result = identity;
  const operations = [
    ...value.matchAll(/(matrix|translate|scale)\s*\(([^)]*)\)/g),
  ];
  if (
    !operations.length ||
    value
      .replace(/(matrix|translate|scale)\s*\([^)]*\)/g, '')
      .replace(/[\s,]/g, '')
  )
    return undefined;
  for (const match of operations) {
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (args.some((n) => !Number.isFinite(n))) return undefined;
    let next: Matrix;
    if (match[1] === 'matrix' && args.length === 6) next = args as Matrix;
    else if (match[1] === 'translate' && args.length >= 1 && args.length <= 2)
      next = [1, 0, 0, 1, args[0], args[1] ?? 0];
    else if (match[1] === 'scale' && args.length >= 1 && args.length <= 2)
      next = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    else return undefined;
    result = multiply(result, next);
  }
  return result.every(Number.isFinite) &&
    result[0] > 0 &&
    result[3] > 0 &&
    Math.abs(result[1]) < 1e-9 &&
    Math.abs(result[2]) < 1e-9
    ? result
    : undefined;
}
const presentation = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'font-size',
  'font-family',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'stroke-dasharray',
  'stroke-dashoffset',
  'marker-start',
  'marker-end',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'clip-path',
  'mask',
  'filter',
  'display',
  'visibility',
  'stroke-linecap',
  'stroke-linejoin',
  'vector-effect',
  'font-style',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
  'writing-mode',
  'baseline-shift',
  'alignment-baseline',
  'color',
]);
function inherited(element: Element, name: string, fallback: string): string {
  let current: Element | null = element;
  while (current) {
    const value = current.getAttribute(name);
    if (value && value !== 'inherit') return value.trim();
    current = current.parentElement;
  }
  return fallback;
}
function number(value: string | null, fallback = 0): number {
  if (value === null || value === '') return fallback;
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i.test(value.trim())
    ? Number.parseFloat(value)
    : NaN;
}
const namedColors: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  lime: '#00ff00',
  olive: '#808000',
  navy: '#000080',
  teal: '#008080',
  aqua: '#00ffff',
  orange: '#ffa500',
  transparent: 'none',
};
function color(value: string, element: Element): string | undefined {
  value = value.toLowerCase().trim();
  if (value === 'currentcolor')
    value = inherited(element, 'color', 'black').toLowerCase();
  if (value === 'none') return value;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value))
    return (
      '#' +
      value
        .slice(1)
        .split('')
        .map((v) => v + v)
        .join('')
    );
  if (namedColors[value]) return namedColors[value];
  const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/.exec(value);
  if (rgb && rgb.slice(1).every((v) => Number(v) <= 255))
    return (
      '#' +
      rgb
        .slice(1)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('')
    );
  return undefined;
}
function complexPaint(element: Element): boolean {
  const defaults: Record<string, string[]> = {
    opacity: ['1'],
    'fill-opacity': ['1'],
    'stroke-opacity': ['1'],
    'clip-path': ['none'],
    mask: ['none'],
    filter: ['none'],
    display: ['inline'],
    visibility: ['visible'],
    'vector-effect': ['none'],
    'stroke-linecap': ['butt'],
    'stroke-linejoin': ['miter'],
    'font-style': ['normal'],
    'letter-spacing': ['normal', '0'],
    'word-spacing': ['normal', '0'],
    'text-decoration': ['none'],
    'writing-mode': ['horizontal-tb'],
    'stroke-dashoffset': ['0', '0px'],
    'baseline-shift': ['baseline', '0', '0px'],
    'alignment-baseline': ['auto'],
  };
  return Object.entries(defaults).some(
    ([key, values]) => !values.includes(inherited(element, key, values[0])),
  );
}
function point(
  x: number,
  y: number,
  matrix: Matrix,
  width: number,
  height: number,
) {
  return {
    x: round(((matrix[0] * x + matrix[4]) * 100) / width),
    y: round(((matrix[3] * y + matrix[5]) * 100) / height),
  };
}
function box(
  x: number,
  y: number,
  width: number,
  height: number,
  matrix: Matrix,
  diagram: Diagram,
) {
  const start = point(x, y, matrix, diagram.width, diagram.height);
  return {
    ...start,
    width: round((width * matrix[0] * 100) / diagram.width),
    height: round((height * matrix[3] * 100) / diagram.height),
  };
}
function within(value: {
  x: number;
  y: number;
  width?: number;
  height?: number;
}): boolean {
  return (
    [value.x, value.y, value.width ?? 0, value.height ?? 0].every(
      Number.isFinite,
    ) &&
    value.x >= 0 &&
    value.y >= 0 &&
    value.x + (value.width ?? 0) <= 100.000001 &&
    value.y + (value.height ?? 0) <= 100.000001 &&
    (value.width === undefined || value.width >= 2) &&
    (value.height === undefined || value.height >= 2)
  );
}
function linePoints(
  element: Element,
): [number, number, number, number] | undefined {
  if (element.localName === 'line')
    return ['x1', 'y1', 'x2', 'y2'].map((key) =>
      number(element.getAttribute(key)),
    ) as [number, number, number, number];
  const d = element.getAttribute('d') ?? '';
  const tokens =
    d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (
    d.replace(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[\s,]/g, '')
  )
    return undefined;
  if (
    tokens.length !== 6 ||
    tokens[0] !== 'M' ||
    !['L', 'l'].includes(tokens[3])
  )
    return undefined;
  const [x1, y1, x2, y2] = [tokens[1], tokens[2], tokens[4], tokens[5]].map(
    Number,
  );
  return tokens[3] === 'l' ? [x1, y1, x1 + x2, y1 + y2] : [x1, y1, x2, y2];
}

/** Convert only representable parts; preserve everything else as inert, ordered SVG. */
export function convertSvgToDiagram(source: string): SvgConversion {
  if (source.length > 1_000_000)
    throw new Error('SVGソースは1 MB以内にしてください。');
  const input = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (
    input.querySelector('parsererror') ||
    input.documentElement.localName !== 'svg'
  )
    throw new Error('SVGの構文を確認してください。');
  const warnings = new Set<string>();
  // Inline CSS is copied only into known presentation attributes, then sanitized.
  for (const element of [
    input.documentElement,
    ...input.querySelectorAll('*'),
  ]) {
    for (const declaration of (element.getAttribute('style') ?? '').split(
      ';',
    )) {
      const separator = declaration.indexOf(':');
      const key = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (separator > 0 && presentation.has(key) && !/!important/i.test(value))
        element.setAttribute(key, value);
      else if (declaration.trim())
        warnings.add(
          '一部のCSS指定は表示用コピーでは適用されません。原本とプレビューを確認してください。',
        );
    }
    element.removeAttribute('style');
  }
  const safe = sanitizeSvgSource(
    serializer().serializeToString(input.documentElement),
  );
  if (safe.changed)
    warnings.add(
      '実行要素・外部参照・埋込画像・スタイルシートを表示用コピーから除去しました。元のSVGソースは保持します。',
    );
  const document = new DOMParser().parseFromString(
    safe.source,
    'image/svg+xml',
  );
  const root = document.documentElement;
  if (root.querySelectorAll('*').length > 4000)
    throw new Error(
      'SVGの要素数が多いため分解できません（上限4,000要素）。ソースのまま編集できます。',
    );
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number) ?? [0, 0, safe.width, safe.height];
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)))
    throw new Error('SVGのviewBoxを確認してください。');
  const minimum = Math.max(320 / safe.width, 180 / safe.height);
  const maximum = Math.min(2400 / safe.width, 1800 / safe.height);
  if (minimum > maximum)
    throw new Error(
      '縦横比が図形編集の対応範囲を超えています。SVGソースのまま編集できます。',
    );
  const scale = Math.min(maximum, Math.max(1, minimum));
  const diagram: Diagram = {
    version: 1,
    width: safe.width * scale,
    height: safe.height * scale,
    shapes: [],
    connections: [],
    svgFragments: [],
  };
  const viewport: Matrix = [
    scale,
    0,
    0,
    scale,
    -viewBox[0] * scale,
    -viewBox[1] * scale,
  ];
  const defs = [...root.querySelectorAll('defs')]
    .filter((element) => !element.parentElement?.closest('defs'))
    .map((element) => serializer().serializeToString(element))
    .join('');
  if (defs) diagram.svgDefinitions = defs;
  const references = new Set(
    [...root.querySelectorAll('[href], [*|href]')]
      .map(
        (element) =>
          element.getAttribute('href') ?? element.getAttribute('xlink:href'),
      )
      .filter((value): value is string => !!value)
      .map((value) => value.slice(1)),
  );
  let order = 0;
  let normalizedArrows = false;
  const retain = (element: Element) => {
    let clone = element.cloneNode(true) as Element;
    let parent = element.parentElement;
    while (parent && parent !== root) {
      const wrapper = parent.cloneNode(false) as Element;
      wrapper.appendChild(clone);
      clone = wrapper;
      parent = parent.parentElement;
    }
    const rootGroup = document.createElementNS(ns, 'g');
    for (const attribute of Array.from(root.attributes))
      if (
        !['viewBox', 'width', 'height', 'xmlns', 'version'].includes(
          attribute.name,
        )
      )
        rootGroup.setAttribute(attribute.name, attribute.value);
    rootGroup.appendChild(clone);
    const wrapper = document.createElementNS(ns, 'g');
    wrapper.setAttribute('transform', `matrix(${viewport.join(' ')})`);
    wrapper.appendChild(rootGroup);
    diagram.svgFragments!.push({
      source: serializer().serializeToString(wrapper),
      paintOrder: order++,
      name: (element.getAttribute('id') || element.localName).slice(0, 200),
    });
  };
  const visit = (
    element: Element,
    parentMatrix: Matrix | undefined,
    group?: string,
  ) => {
    if (['defs', 'title', 'desc', 'metadata'].includes(element.localName))
      return;
    const local = transform(element.getAttribute('transform'));
    const matrix =
      parentMatrix && local ? multiply(parentMatrix, local) : undefined;
    if (
      !matrix ||
      complexPaint(element) ||
      (element.id && references.has(element.id))
    ) {
      retain(element);
      return;
    }
    if (element.localName === 'g') {
      const childGroup = group ?? createNodeId();
      for (const child of Array.from(element.children))
        visit(child, matrix, childGroup);
      return;
    }
    const fill = color(inherited(element, 'fill', 'black'), element);
    const stroke = color(inherited(element, 'stroke', 'none'), element);
    const strokeWidth =
      stroke === 'none'
        ? 0
        : number(inherited(element, 'stroke-width', '1')) * matrix[0];
    if (
      fill === undefined ||
      stroke === undefined ||
      !Number.isFinite(strokeWidth) ||
      strokeWidth < 0 ||
      strokeWidth > 12 ||
      (strokeWidth > 0 && Math.abs(matrix[0] - matrix[3]) > 1e-9)
    ) {
      retain(element);
      return;
    }
    const dash = inherited(element, 'stroke-dasharray', 'none');
    const common = {
      id: createNodeId(),
      name: (element.id || `${element.localName} ${order + 1}`).slice(0, 200),
      text: '',
      fill,
      stroke: stroke === 'none' ? '#000000' : stroke,
      strokeWidth,
      fontSize: 24,
      locked: false,
      paintOrder: order,
      ...(group ? { groupId: group } : {}),
    };
    let shape: DiagramShape | undefined;
    if (element.localName === 'rect' && dash === 'none') {
      const width = number(element.getAttribute('width'));
      const height = number(element.getAttribute('height'));
      const rx =
        number(element.getAttribute('rx'), number(element.getAttribute('ry'))) *
        matrix[0];
      const ry =
        number(element.getAttribute('ry'), number(element.getAttribute('rx'))) *
        matrix[3];
      shape = {
        ...common,
        kind: 'rectangle',
        ...box(
          number(element.getAttribute('x')),
          number(element.getAttribute('y')),
          width,
          height,
          matrix,
          diagram,
        ),
        cornerRadius: rx,
        cornerRadiusY: ry,
      };
    } else if (
      ['circle', 'ellipse'].includes(element.localName) &&
      dash === 'none'
    ) {
      const rx = number(
        element.getAttribute(element.localName === 'circle' ? 'r' : 'rx'),
      );
      const ry = number(
        element.getAttribute(element.localName === 'circle' ? 'r' : 'ry'),
      );
      shape = {
        ...common,
        kind: 'ellipse',
        ...box(
          number(element.getAttribute('cx')) - rx,
          number(element.getAttribute('cy')) - ry,
          rx * 2,
          ry * 2,
          matrix,
          diagram,
        ),
      };
    } else if (
      element.localName === 'text' &&
      !element.children.length &&
      !['textLength', 'lengthAdjust', 'rotate'].some((attribute) =>
        element.hasAttribute(attribute),
      ) &&
      inherited(element, 'xml:space', 'default') !== 'preserve' &&
      strokeWidth === 0 &&
      fill !== 'none' &&
      Math.abs(matrix[0] - matrix[3]) < 1e-9
    ) {
      const fontSize =
        number(inherited(element, 'font-size', '16')) * matrix[0];
      const anchor = inherited(element, 'text-anchor', 'start');
      const baseline = inherited(element, 'dominant-baseline', 'alphabetic');
      const weight = inherited(element, 'font-weight', 'normal');
      const position = point(
        number(element.getAttribute('x')) + number(element.getAttribute('dx')),
        number(element.getAttribute('y')) + number(element.getAttribute('dy')),
        matrix,
        diagram.width,
        diagram.height,
      );
      const text = (element.textContent ?? '').replace(/\s+/g, ' ');
      // The hit box is approximate; anchor and baseline stay at the original coordinates.
      const width = Math.max(
        2,
        (text.length * fontSize * 0.65 * 100) / diagram.width,
      );
      const height = Math.max(2, (fontSize * 1.2 * 100) / diagram.height);
      if (
        ['start', 'middle', 'end'].includes(anchor) &&
        ['alphabetic', 'auto', 'central'].includes(baseline) &&
        ['normal', '400', 'bold', '700'].includes(weight)
      ) {
        shape = {
          ...common,
          kind: 'text',
          x:
            position.x -
            (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0),
          y: position.y - height / 2,
          width,
          height,
          text,
          fill: 'none',
          textColor: fill,
          fontSize,
          textAnchor: anchor as 'start' | 'middle' | 'end',
          textBaseline: baseline === 'central' ? 'central' : 'alphabetic',
          fontFamily: inherited(element, 'font-family', 'serif'),
          fontWeight: weight === 'bold' || weight === '700' ? 'bold' : 'normal',
        };
      }
    } else if (
      ['line', 'path'].includes(element.localName) &&
      strokeWidth >= 0.5 &&
      (dash === 'none' ||
        (Math.abs(matrix[0] - 1) < 1e-9 &&
          dash.replace(/[,\s]+/g, ' ').trim() === '8 5'))
    ) {
      const coordinates = linePoints(element);
      if (coordinates) {
        const start = point(
          coordinates[0],
          coordinates[1],
          matrix,
          diagram.width,
          diagram.height,
        );
        const end = point(
          coordinates[2],
          coordinates[3],
          matrix,
          diagram.width,
          diagram.height,
        );
        const startMarker =
          inherited(element, 'marker-start', 'none') !== 'none';
        const endMarker = inherited(element, 'marker-end', 'none') !== 'none';
        if (within(start) && within(end) && diagram.connections.length < 300) {
          diagram.connections.push({
            id: common.id,
            name: common.name,
            start: { type: 'point', ...start },
            end: { type: 'point', ...end },
            arrow:
              startMarker && endMarker
                ? 'both'
                : startMarker
                  ? 'start'
                  : endMarker
                    ? 'end'
                    : 'none',
            color: common.stroke,
            strokeWidth,
            dash: dash === 'none' ? 'solid' : 'dashed',
            label: '',
            locked: false,
            paintOrder: order++,
          });
          normalizedArrows ||= startMarker || endMarker;
          return;
        }
      }
    }
    if (shape && within(shape) && diagram.shapes.length < 200) {
      // Full schema validation below also bounds font sizes, labels and corner radii.
      const candidate = diagramSchema.safeParse({
        ...diagram,
        shapes: [...diagram.shapes, shape],
      });
      if (candidate.success) {
        diagram.shapes.push(shape);
        order++;
        return;
      }
    }
    retain(element);
  };
  const rootTransform = transform(root.getAttribute('transform'));
  if (!rootTransform || complexPaint(root)) {
    // Root opacity/filter/clip is composited once over all children.
    const whole = root.cloneNode(true) as Element;
    whole.setAttribute('width', String(diagram.width));
    whole.setAttribute('height', String(diagram.height));
    diagram.svgFragments = [
      {
        source: serializer().serializeToString(whole),
        paintOrder: 0,
        name: 'svg',
      },
    ];
    delete diagram.svgDefinitions;
  } else {
    for (const child of Array.from(root.children))
      visit(child, multiply(viewport, rootTransform));
  }
  // Attach only exact side-center endpoints; inferred gaps remain free points.
  for (const edge of diagram.connections) {
    for (const key of ['start', 'end'] as const) {
      const endpoint = edge[key];
      if (endpoint.type !== 'point') continue;
      const candidates: DiagramEndpoint[] = [];
      for (const shape of diagram.shapes.filter(
        (item) => item.kind !== 'text',
      )) {
        const sides = {
          top: { x: shape.x + shape.width / 2, y: shape.y },
          right: { x: shape.x + shape.width, y: shape.y + shape.height / 2 },
          bottom: { x: shape.x + shape.width / 2, y: shape.y + shape.height },
          left: { x: shape.x, y: shape.y + shape.height / 2 },
        };
        for (const [side, point] of Object.entries(sides))
          if (Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < 0.01)
            candidates.push({
              type: 'shape',
              shapeId: shape.id,
              side: side as 'top' | 'right' | 'bottom' | 'left',
            });
      }
      if (candidates.length === 1) edge[key] = candidates[0];
    }
  }
  if (normalizedArrows)
    warnings.add(
      '矢印の先端は編集可能な標準三角形に統一します。向きは引き継ぎます。',
    );
  if (diagram.shapes.some((shape) => shape.kind === 'text'))
    warnings.add(
      '文字の選択枠は概算です。文字位置を保持しますが、フォント環境により見え方が変わる場合があります。',
    );
  const validated = diagramSchema.safeParse(diagram);
  if (!validated.success)
    throw new Error(
      '保持するSVG部品が編集データの上限を超えました。SVGソースのまま編集できます。',
    );
  return {
    diagram: validated.data,
    previewSource: safe.source,
    editableParts: diagram.shapes.length + diagram.connections.length,
    retainedParts: diagram.svgFragments!.length,
    warnings: [...warnings],
  };
}
