import { describe, expect, it } from 'vitest';
import { checkSlideGeometry, type SlideCheckMeasurement } from './slide-check';

const canvas = { left: 0, top: 0, right: 920, bottom: 517.5 };
const example: SlideCheckMeasurement = {
  page: 3,
  title: 'Results',
  canvas,
  footer: { left: 66, top: 484, right: 854, bottom: 500 },
  elements: [],
};

describe('slide geometry checks', () => {
  it('finds a positioned figure caption outside the page and over the footer', () => {
    const issues = checkSlideGeometry({
      ...example,
      elements: [
        {
          nodeId: 'figure-1',
          name: 'Figure 1',
          rect: { left: 100, top: 400, right: 500, bottom: 480 },
          contentRect: { left: 100, top: 400, right: 500, bottom: 535 },
        },
      ],
    });
    expect(issues.map((issue) => issue.kind)).toEqual([
      'overflow',
      'footer-overlap',
    ]);
    expect(issues[0]).toMatchObject({
      page: 3,
      title: 'Results',
      nodeId: 'figure-1',
    });
  });

  it('reports independent overlaps but excludes contained list/table blocks', () => {
    const issues = checkSlideGeometry({
      ...example,
      elements: [
        {
          nodeId: 'list',
          name: 'List',
          rect: { left: 0, top: 0, right: 300, bottom: 100 },
        },
        {
          nodeId: 'text',
          name: 'Text',
          ancestorNodeIds: ['list'],
          rect: { left: 20, top: 20, right: 280, bottom: 60 },
        },
        {
          nodeId: 'figure',
          name: 'Figure',
          rect: { left: 250, top: 0, right: 400, bottom: 100 },
        },
      ],
    });
    expect(issues.filter((issue) => issue.kind === 'overlap')).toHaveLength(2);
    expect(
      issues.some(
        (issue) => issue.nodeId === 'list' && issue.otherName === 'Text',
      ),
    ).toBe(false);
  });

  it('checks actual minimum text size and tolerates edge touching/subpixel noise', () => {
    const source = {
      ...example,
      elements: [
        {
          nodeId: 'a',
          name: 'Body',
          rect: { left: 0, top: 0, right: 400, bottom: 100 },
          smallestFontSize: 11,
        },
        {
          nodeId: 'b',
          name: 'Table',
          rect: { left: 400, top: 0, right: 921, bottom: 100 },
          smallestFontSize: 12,
        },
      ],
    };
    const unchanged = JSON.stringify(source);
    expect(checkSlideGeometry(source)).toEqual([
      expect.objectContaining({
        kind: 'small-text',
        nodeId: 'a',
        fontSize: 11,
      }),
    ]);
    expect(checkSlideGeometry(source, 10)).toEqual([]);
    expect(JSON.stringify(source)).toBe(unchanged);
  });

  it('reports clipped scroll containers and unavailable layout rather than a false pass', () => {
    expect(checkSlideGeometry({ ...example, clipped: true })[0].kind).toBe(
      'overflow',
    );
    expect(
      checkSlideGeometry({
        ...example,
        canvas: { left: 0, top: 0, right: 0, bottom: 0 },
      })[0].kind,
    ).toBe('measurement-unavailable');
  });

  it('keeps generated-note issue IDs distinct while focusing the original paragraph', () => {
    const issues = checkSlideGeometry({
      ...example,
      elements: [
        {
          nodeId: 'generated-footnote-0-0',
          focusNodeId: 'paragraph-1',
          name: 'Footnote 1',
          rect: { left: 66, top: 490, right: 854, bottom: 510 },
          smallestFontSize: 10,
        },
      ],
    });
    expect(issues.map((issue) => issue.kind)).toEqual([
      'footer-overlap',
      'small-text',
    ]);
    expect(issues.every((issue) => issue.nodeId === 'paragraph-1')).toBe(true);
    expect(issues[0].id).toContain('generated-footnote-0-0');
  });
});
