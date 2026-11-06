import { describe, expect, it } from 'vitest';
import type { DocumentNode, ParagraphNode } from './model';
import { defaultPageSettings } from './page-settings';
import {
  isFirstLineIndent,
  paragraphAfterHeadingIds,
  resolveParagraphIndent,
} from './paragraph-format';

const paragraph = (id: string, text = '本文'): ParagraphNode => ({
  type: 'paragraph',
  attrs: { nodeId: id },
  content: text ? [{ type: 'text', text }] : [],
});
const heading = (id: string): DocumentNode => ({
  type: 'heading',
  attrs: { nodeId: id, level: 1 },
  content: [{ type: 'text', text: '見出し' }],
});
const settings = { ...defaultPageSettings, first_line_indent: 1 };
const bodyContext = { topLevel: true, afterHeading: false };

describe('first-line indent validation', () => {
  it.each([
    { mode: 'inherit' },
    { mode: 'em', value: 0 },
    { mode: 'em', value: 0.5 },
    { mode: 'em', value: 8 },
  ])('accepts %j', (value) => expect(isFirstLineIndent(value)).toBe(true));

  it.each([
    null,
    undefined,
    [],
    1,
    'inherit',
    {},
    { mode: 'inherit', value: 1 },
    { mode: 'em' },
    { mode: 'em', value: '1' },
    { mode: 'em', value: -1 },
    { mode: 'em', value: 8.1 },
    { mode: 'em', value: NaN },
    { mode: 'em', value: Infinity },
    { mode: 'em', value: 1, extra: true },
    { mode: 'unknown' },
  ])('rejects %j', (value) => expect(isFirstLineIndent(value)).toBe(false));
});

describe('paragraph context after headings', () => {
  it('passes consecutive headings, empty paragraphs and explicit page breaks', () => {
    const blank = paragraph('blank', '　\t ');
    blank.content!.push({ type: 'hardBreak' });
    const nodes: DocumentNode[] = [
      paragraph('before'),
      heading('h1'),
      heading('h2'),
      blank,
      { type: 'pageBreak', attrs: { nodeId: 'page' } },
      paragraph('first'),
      paragraph('second'),
      heading('h3'),
      { type: 'slideBreak', attrs: { nodeId: 'break' } },
      paragraph('next-chapter'),
    ];
    expect([...paragraphAfterHeadingIds(nodes)]).toEqual([
      'first',
      'next-chapter',
    ]);
    expect(blank.content![0]).toEqual({ type: 'text', text: '　\t ' });
  });

  it.each<DocumentNode>([
    { type: 'horizontalRule', attrs: { nodeId: 'separator' } },
    { type: 'blockMath', attrs: { nodeId: 'math', latex: 'x=1' } },
    {
      type: 'blockquote',
      attrs: { nodeId: 'quote' },
      content: [heading('nested'), paragraph('inside')],
    },
    {
      type: 'bulletList',
      attrs: { nodeId: 'list' },
      content: [
        {
          type: 'listItem',
          attrs: { nodeId: 'item' },
          content: [paragraph('inside')],
        },
      ],
    },
  ])('ends the heading context at $type', (node) => {
    expect([
      ...paragraphAfterHeadingIds([heading('h'), node, paragraph('after')]),
    ]).toEqual([]);
  });

  it('treats a paragraph containing only inline math as content', () => {
    const math = paragraph('inline', '');
    math.content = [{ type: 'inlineMath', attrs: { latex: 'x' } }];
    expect([
      ...paragraphAfterHeadingIds([heading('h'), math, paragraph('after')]),
    ]).toEqual(['inline']);
  });
});

describe('resolved paragraph indent', () => {
  it('keeps the legacy zero default and applies document rules only to body paragraphs', () => {
    const node = paragraph('body');
    expect(
      resolveParagraphIndent(node, defaultPageSettings, bodyContext),
    ).toMatchObject({
      em: 0,
      source: 'document',
      style: { textIndent: '0em' },
    });
    expect(resolveParagraphIndent(node, settings, bodyContext)).toMatchObject({
      em: 1,
      source: 'document',
    });
    node.attrs.firstLineIndent = { mode: 'em', value: 2 };
    expect(
      resolveParagraphIndent(node, settings, {
        topLevel: false,
        afterHeading: false,
      }),
    ).toEqual({ em: 0, source: 'excluded', style: { textIndent: '0em' } });
  });

  it('distinguishes an omitted or null attribute from explicitly inheriting over an old ruler', () => {
    const node = paragraph('body');
    node.attrs.textRuler = { left: 10, right: 10, firstLine: 5 };
    const legacy = resolveParagraphIndent(node, settings, bodyContext);
    expect(legacy).toEqual({
      em: null,
      source: 'ruler',
      style: { marginLeft: '10%', marginRight: '10%', textIndent: '-6.25%' },
    });
    node.attrs.firstLineIndent = null;
    expect(resolveParagraphIndent(node, settings, bodyContext)).toEqual(legacy);
    node.attrs.firstLineIndent = { mode: 'inherit' };
    expect(resolveParagraphIndent(node, settings, bodyContext)).toEqual({
      em: 1,
      source: 'document',
      style: { marginLeft: '10%', marginRight: '10%', textIndent: '1em' },
    });
    expect(node.attrs.textRuler).toEqual({ left: 10, right: 10, firstLine: 5 });
  });

  it('applies the optional heading exception unless an explicit indent or legacy ruler takes priority', () => {
    const node = paragraph('body');
    const context = { topLevel: true, afterHeading: true };
    const headingSettings = {
      ...settings,
      after_heading_indent: 'none' as const,
    };
    expect(resolveParagraphIndent(node, settings, context)).toMatchObject({
      em: 1,
      source: 'document',
    });
    expect(
      resolveParagraphIndent(node, headingSettings, context),
    ).toMatchObject({ em: 0, source: 'heading' });
    node.attrs.firstLineIndent = { mode: 'em', value: 1 };
    expect(
      resolveParagraphIndent(node, headingSettings, context),
    ).toMatchObject({ em: 1, source: 'explicit' });
    node.attrs.firstLineIndent = null;
    node.attrs.textRuler = { left: 0, right: 0, firstLine: 5 };
    expect(
      resolveParagraphIndent(node, headingSettings, context),
    ).toMatchObject({ em: null, source: 'ruler' });
  });

  it('preserves one em and zero exceptions through paper, margin, font and global indent changes', () => {
    const node = paragraph('body');
    node.attrs.textRuler = { left: 20, right: 5, firstLine: 30 };
    node.attrs.firstLineIndent = { mode: 'em', value: 1 };
    const resized = {
      ...settings,
      paper: 'A3' as const,
      font_size: 24,
      margin_left: 40,
      first_line_indent: 2,
    };
    expect(resolveParagraphIndent(node, resized, bodyContext)).toEqual(
      resolveParagraphIndent(node, settings, bodyContext),
    );
    node.attrs.firstLineIndent = { mode: 'em', value: 0 };
    expect(resolveParagraphIndent(node, resized, bodyContext)).toMatchObject({
      em: 0,
      source: 'explicit',
      style: { marginLeft: '20%', marginRight: '5%', textIndent: '0em' },
    });
  });

  it('preserves nested legacy ruler formatting while ignoring new body-only attributes', () => {
    const node = paragraph('cell');
    node.attrs.textRuler = { left: 10, right: 10, firstLine: 20 };
    node.attrs.firstLineIndent = { mode: 'em', value: 8 };
    expect(
      resolveParagraphIndent(node, settings, {
        topLevel: false,
        afterHeading: true,
      }),
    ).toMatchObject({
      em: null,
      source: 'ruler',
      style: { textIndent: '12.5%' },
    });
  });

  it('does not silently clamp em values to a narrow ruler area', () => {
    const node = paragraph('narrow');
    node.attrs.textRuler = { left: 85, right: 0, firstLine: 85 };
    node.attrs.firstLineIndent = { mode: 'em', value: 1 };
    expect(
      resolveParagraphIndent(node, { ...settings, font_size: 24 }, bodyContext),
    ).toMatchObject({ em: 1, style: { marginLeft: '85%', textIndent: '1em' } });
  });
});
