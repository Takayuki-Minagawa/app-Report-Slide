import { describe, expect, it } from 'vitest';
import type { TableNode } from '@/src/document/model';
import { resolveReportStyle } from '@/src/document/report-style';
import { analyzeDocument } from '@/src/document/semantics';
import { resolveReportSettings } from '@/src/document/report-settings';
import { parseMarkdown } from '@/src/markdown/parser';
import { planHeadingNumbering, sequenceName } from './numbering';
import { displayWidth, tableBorders, tableGrid } from './table';

const report = (frontMatter: string, body: string) =>
  parseMarkdown(`---\ntype: report\n${frontMatter}\n---\n\n${body}`).document;
const table = (markdown: string) =>
  report('', markdown).children.find(
    (node): node is TableNode => node.type === 'table',
  )!;

describe('Word table layout', () => {
  it('counts full-width characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('階数')).toBe(4);
    expect(displayWidth('ｶﾅ')).toBe(2);
    expect(displayWidth('A棟 1階')).toBe(7);
  });

  it('distributes the available width by the longest cell within bounds', () => {
    const grid = tableGrid(
      table(
        '| 階 | 備考 |\n| --- | --- |\n| 1 | 長い備考の文章がここに入ります |',
      ),
      9000,
    );
    expect(grid.widths).toHaveLength(2);
    expect(grid.widths[0] + grid.widths[1]).toBeLessThanOrEqual(9000);
    expect(grid.widths[0] + grid.widths[1]).toBeGreaterThan(8990);
    expect(grid.widths[1] / grid.widths[0]).toBeGreaterThan(3);
    // No column falls below 8% however short its text is.
    const many = tableGrid(
      table(
        '| a | b | c | 説明 |\n| - | - | - | --- |\n| 1 | 2 | 3 | ' +
          'とても長い説明'.repeat(20) +
          ' |',
      ),
      9000,
    );
    expect(Math.min(...many.widths)).toBeGreaterThan(9000 * 0.07);
    expect(Math.max(...many.widths)).toBeLessThan(9000 * 0.8);
  });

  it('keeps stored column widths in proportion', () => {
    const node = table('| A | B |\n| - | - |\n| 1 | とても長い文章 |');
    for (const row of node.content) {
      row.content![0].attrs.colwidth = [300];
      row.content![1].attrs.colwidth = [100];
    }
    const { widths } = tableGrid(node, 9000);
    expect(widths[0]).toBe(widths[1] * 3);
  });

  it('writes table rules only when the style defines them', () => {
    expect(tableBorders(resolveReportStyle({}))).toBeUndefined();
    const rules = tableBorders(resolveReportStyle({ theme: 'report-jp' }))!;
    expect(rules.insideHorizontal).toMatchObject({ size: 6, color: '000000' });
    expect(
      tableBorders(
        resolveReportStyle({ report_style: { table: { border_width: 0 } } }),
      )!.top,
    ).toMatchObject({ style: 'none' });
  });
});

describe('Word heading numbering plan', () => {
  const plan = (
    frontMatter: string,
    body: string,
    locale: 'ja' | 'en' = 'ja',
  ) => {
    const document = report(`number_sections: true\n${frontMatter}`, body);
    return planHeadingNumbering(
      analyzeDocument(document),
      resolveReportSettings(document.metadata),
      locale,
    );
  };

  it('maps numbered headings to list levels and leaves unnumbered ones out', () => {
    const result = plan(
      'report_settings:\n  appendix_numbering: letter',
      '# A\n{#a}\n\n## B\n{#b}\n\n## C\n{#c numbered=false}\n\n# D\n{#d appendix=true}\n\n## E\n{#e}',
    )!;
    expect([...result.levels.values()]).toEqual([
      { reference: 'kumi-headings', level: 0 },
      { reference: 'kumi-headings', level: 1 },
      { reference: 'kumi-appendix', level: 0 },
      { reference: 'kumi-appendix', level: 1 },
    ]);
    expect(result.config[1].levels[0].text).toBe('付録 %1');
    expect(result.config[0].levels[2].text).toBe('%1.%2.%3');
  });

  it('uses the chapter wording of the locale', () => {
    const chapters = 'report_settings:\n  heading_numbering: chapter';
    expect(plan(chapters, '# A\n\n## B')!.config[0].levels[0].text).toBe(
      '第%1章',
    );
    expect(plan(chapters, '# A', 'en')!.config[0].levels[0].text).toBe(
      'Chapter %1',
    );
  });

  it('declines when Word would count differently or nothing is numbered', () => {
    expect(plan('', '# A\n\n### C')).toBeUndefined();
    expect(plan('', '## Only a second level')).toBeUndefined();
    expect(
      planHeadingNumbering(
        analyzeDocument(report('', '# A')),
        resolveReportSettings({}),
        'ja',
      ),
    ).toBeUndefined();
    expect(
      plan(
        'report_settings:\n  appendix_numbering: letter',
        Array.from(
          { length: 27 },
          (_, index) => `# Appendix ${index}\n{appendix=true}`,
        ).join('\n\n'),
      ),
    ).toBeUndefined();
  });

  it('names caption sequences by locale', () => {
    expect(sequenceName('figure', 'ja')).toBe('図');
    expect(sequenceName('blockMath', 'en')).toBe('Equation');
  });
});
