import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  applySlideDesign,
  createSlideComposite,
  getSlidePageId,
  resolveSlideDesign,
} from './slide-design';
import {
  rasterPixelRatio,
  slideCheckSuggestions,
  type SlideCheckIssue,
} from './slide-check';

describe('content-preserving check suggestions', () => {
  it('offers table and region controls without modifying source data or recommending smaller text', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n# Long table\n\n| Method | Value |\n| --- | --- |\n| A | 42 |',
    ).document;
    document.metadata = applySlideDesign(
      document,
      [getSlidePageId(document, 0)],
      {
        ...resolveSlideDesign(document, 0),
        layout: 'composite',
        composite: createSlideComposite(document.children),
      },
    );
    const before = JSON.stringify(document);
    const issue: SlideCheckIssue = {
      id: 'one',
      page: 1,
      title: 'Long table',
      kind: 'overflow',
      nodeId: document.children[1].attrs.nodeId,
      name: '表1',
    };
    const suggestions = slideCheckSuggestions(document, issue, 'ja').join(' ');
    expect(suggestions).toContain('全幅');
    expect(suggestions).toContain('ヘッダー');
    expect(suggestions).toContain('主領域の幅');
    expect(JSON.stringify(document)).toBe(before);
  });
  it('measures both image dimensions and ignores zero or unknown bounds', () => {
    expect(rasterPixelRatio(800, 400, 400, 200)).toBe(2);
    expect(rasterPixelRatio(800, 100, 400, 200)).toBe(0.5);
    expect(rasterPixelRatio(0, 400, 400, 200)).toBeUndefined();
    expect(rasterPixelRatio(800, 400, 0, 0)).toBeUndefined();
  });
});
