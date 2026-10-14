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
  slideCheckRepairs,
  slideCheckRepairMetadata,
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
    expect(
      slideCheckRepairs(document, issue).map((repair) => repair.action),
    ).toEqual(['full-width-table', 'split-table']);
    const repaired = slideCheckRepairMetadata(
      document,
      issue.nodeId!,
      'full-width-table',
    );
    expect(
      resolveSlideDesign({ ...document, metadata: repaired! }, 0).composite
        ?.assignments[0].region,
    ).toBe('bottom');
    expect(JSON.stringify(document)).toBe(before);
    expect(
      slideCheckRepairMetadata(document, 'missing', 'full-width-table'),
    ).toBeUndefined();
  });
  it('measures both image dimensions and ignores zero or unknown bounds', () => {
    expect(rasterPixelRatio(800, 400, 400, 200)).toBe(2);
    expect(rasterPixelRatio(800, 100, 400, 200)).toBe(0.5);
    expect(rasterPixelRatio(0, 400, 400, 200)).toBeUndefined();
    expect(rasterPixelRatio(800, 400, 0, 0)).toBeUndefined();
  });

  it.each(['table', 'group member'] as const)(
    'blocks repairs when the %s is locked, including an already offered repair',
    (lockedTarget) => {
      const document = parseMarkdown(
        '---\ntype: slide\n---\n# Results\n\n| Method | Value |\n| --- | --- |\n| A | 42 |\n\nRelated explanation',
      ).document;
      const table = document.children.find((node) => node.type === 'table')!;
      const peer = document.children.find((node) => node.type === 'paragraph')!;
      table.attrs.blockLayout = { groupId: 'comparison' };
      peer.attrs.blockLayout = { groupId: 'comparison' };
      document.metadata = applySlideDesign(
        document,
        [getSlidePageId(document, 0)],
        {
          ...resolveSlideDesign(document, 0),
          layout: 'composite',
          composite: createSlideComposite(document.children),
        },
      );
      const issue: SlideCheckIssue = {
        id: 'cell-overflow',
        page: 1,
        title: 'Results',
        kind: 'overflow',
        nodeId: table.content[1].content![0].attrs.nodeId,
        name: 'Value cell',
      };
      expect(slideCheckRepairs(document, issue)).toContainEqual({
        nodeId: table.attrs.nodeId,
        action: 'full-width-table',
      });
      (lockedTarget === 'table' ? table : peer).attrs.blockLayout = {
        groupId: 'comparison',
        locked: true,
      };
      const before = JSON.stringify(document);
      expect(slideCheckRepairs(document, issue)).toEqual([]);
      expect(
        slideCheckRepairMetadata(
          document,
          table.attrs.nodeId,
          'full-width-table',
        ),
      ).toBeUndefined();
      expect(slideCheckSuggestions(document, issue, 'ja').join(' ')).toContain(
        'ロックを解除',
      );
      expect(JSON.stringify(document)).toBe(before);

      // A lock elsewhere on the page must not disable this table's repair.
      table.attrs.blockLayout = { groupId: 'comparison' };
      peer.attrs.blockLayout = { groupId: 'unrelated', locked: true };
      expect(slideCheckRepairs(document, issue)).toContainEqual({
        nodeId: table.attrs.nodeId,
        action: 'full-width-table',
      });
      expect(
        slideCheckRepairMetadata(
          document,
          table.attrs.nodeId,
          'full-width-table',
        ),
      ).toBeDefined();
    },
  );
});
