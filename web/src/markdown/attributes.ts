import type { DocumentNode } from '@/src/document/model';
import { labelPattern, semanticTypes } from '@/src/document/semantics';

/** A strict single-line attribute grammar. Quoted values follow JSON string escaping. */
export function parseBlockAttributes(
  source: string,
  node: DocumentNode | undefined,
): Record<string, unknown> {
  if (!node || !semanticTypes.has(node.type))
    throw new Error('属性行は見出し・図・表・式の直後に指定してください');
  if (!source.endsWith('}')) throw new Error('属性行の末尾に } が必要です');
  let rest = source.slice(1, -1).trim();
  const attrs: Record<string, unknown> = {};
  while (rest) {
    const match =
      /^(?:#([A-Za-z][A-Za-z0-9:._-]*)|([a-z_]+)=("(?:[^"\\]|\\.)*"|[^\s]+))(?:\s+|$)/.exec(
        rest,
      );
    if (!match) throw new Error(`属性の記法を確認してください: ${rest}`);
    const key = match[1] ? 'label' : match[2];
    if (
      !['label', 'caption', 'numbered', 'width', 'align'].includes(key) ||
      Object.hasOwn(attrs, key)
    )
      throw new Error(`未知または重複した属性です: ${key}`);
    let value: unknown = match[1] ?? match[3];
    if (typeof value === 'string' && value.startsWith('"'))
      value = JSON.parse(value);
    if (
      key === 'label' &&
      (typeof value !== 'string' || !labelPattern.test(value))
    )
      throw new Error(
        'ラベルは英字から始まる128文字以内の英数字・:._-で指定してください',
      );
    if (key === 'caption' && node.type === 'heading')
      throw new Error('見出しにはcaptionを指定できません');
    if (key === 'numbered') {
      if (value !== 'true' && value !== 'false')
        throw new Error('numberedにはtrueまたはfalseを指定してください');
      value = value === 'true';
    }
    if (key === 'width' || key === 'align') {
      if (node.type !== 'figure')
        throw new Error(`${key}は図だけに指定できます`);
      if (key === 'width') {
        if (typeof value !== 'string' || !/^\d+(?:\.\d+)?%?$/.test(value))
          throw new Error('widthは10〜100%で指定してください');
        value = Number(value.replace(/%$/, ''));
        if ((value as number) < 10 || (value as number) > 100)
          throw new Error('widthは10〜100%で指定してください');
      } else if (!['left', 'center', 'right'].includes(String(value)))
        throw new Error('alignはleft・center・rightで指定してください');
    }
    attrs[key] = value;
    rest = rest.slice(match[0].length);
  }
  return attrs;
}

export function serializeBlockAttributes(node: DocumentNode): string {
  if (!semanticTypes.has(node.type)) return '';
  const attrs: string[] = [];
  if (node.attrs.label) attrs.push(`#${node.attrs.label}`);
  if (node.type === 'figure') {
    if (node.attrs.width !== 100) attrs.push(`width=${node.attrs.width}%`);
    if (node.attrs.align !== 'center') attrs.push(`align=${node.attrs.align}`);
  }
  if (node.attrs.caption != null)
    attrs.push(`caption=${JSON.stringify(node.attrs.caption)}`);
  if (node.attrs.numbered != null)
    attrs.push(`numbered=${node.attrs.numbered}`);
  return attrs.length
    ? `${node.type === 'table' ? '\n\n' : '\n'}{${attrs.join(' ')}}`
    : '';
}
