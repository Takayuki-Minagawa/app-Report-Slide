import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  calloutLabel,
  captionParts,
  contentsTitle,
  formatPageNumber,
  headingPrefix,
  joinCaption,
  pageNumberParts,
  romanNumeral,
} from './format';
import { analyzeDocument } from './semantics';
import {
  defaultReportSettings,
  reportSettingsIssues,
  resolveReportSettings,
} from './report-settings';

const report = (frontMatter: string, body: string) =>
  parseMarkdown(`---\ntype: report\n${frontMatter}\n---\n\n${body}`).document;

describe('shared number and separator formatting', () => {
  it('builds caption parts with the configured separator only between two parts', () => {
    const document = report(
      '',
      '![Alt](a.png)\n{#fig:a caption="Frame"}\n\n![Alt](b.png)\n{#fig:b}',
    );
    const [first, second] = [...analyzeDocument(document).targets.values()];
    expect(captionParts(first, 'Frame', 'ja')).toEqual({
      label: '図 1',
      separator: ' — ',
      text: 'Frame',
    });
    expect(captionParts(first, 'Frame', 'en', ': ')).toEqual({
      label: 'Figure 1',
      separator: ': ',
      text: 'Frame',
    });
    expect(captionParts(second, '', 'ja', ': ').separator).toBe('');
    expect(captionParts(undefined, 'Only text', 'ja').label).toBe('');
    expect(joinCaption(['図 1', '', 'Frame', undefined], ': ')).toBe(
      '図 1: Frame',
    );
  });

  it('formats page numbers, their Word parts and Roman numerals', () => {
    expect(formatPageNumber('{n}', 3)).toBe('3');
    expect(formatPageNumber('- {n} -', 3)).toBe('- 3 -');
    expect(formatPageNumber('{n} / {total}', 3, 12)).toBe('3 / 12');
    expect(pageNumberParts('- {n} / {total} -')).toEqual([
      { type: 'text', value: '- ' },
      { type: 'n' },
      { type: 'text', value: ' / ' },
      { type: 'total' },
      { type: 'text', value: ' -' },
    ]);
    expect([1, 4, 9, 14, 40, 1994].map(romanNumeral)).toEqual([
      'i',
      'iv',
      'ix',
      'xiv',
      'xl',
      'mcmxciv',
    ]);
  });

  it('validates page number formats and keeps the contents format in step', () => {
    expect(reportSettingsIssues({ page_number_format: '- {n} -' })).toEqual([]);
    expect(reportSettingsIssues({ page_number_format: 'page' })).not.toEqual(
      [],
    );
    expect(reportSettingsIssues({ page_number_format: '{n} {x}' })).not.toEqual(
      [],
    );
    expect(
      resolveReportSettings({
        report_settings: { page_number_format: 'p.{n}' },
      }).toc_page_number_format,
    ).toBe('p.{n}');
    expect(
      resolveReportSettings({
        report_settings: {
          page_number_format: 'p.{n}',
          toc_page_number_format: '{n}',
        },
      }).toc_page_number_format,
    ).toBe('{n}');
  });

  it('keeps every earlier default and lets the Word-style theme replace only unset values', () => {
    expect(resolveReportSettings({ theme: 'latex' })).toEqual(
      defaultReportSettings,
    );
    const themed = resolveReportSettings({ theme: 'report-jp' });
    expect(themed).toMatchObject({
      page_number_format: '- {n} -',
      toc_page_number_format: '- {n} -',
      page_number_position: 'bottom-center',
      cover_layout: 'centered',
    });
    expect(
      resolveReportSettings({
        theme: 'report-jp',
        report_settings: { page_number_format: '{n}' },
      }),
    ).toMatchObject({
      page_number_format: '{n}',
      toc_page_number_format: '{n}',
    });
  });

  it('resolves callout and contents titles from settings, then theme, then locale', () => {
    expect(calloutLabel('note', 'ja', {})).toBe('注記');
    expect(calloutLabel('note', 'ja', { theme: 'report-jp' })).toBe('（注）');
    expect(calloutLabel('important', 'en', { theme: 'report-jp' })).toBe(
      'Important',
    );
    const custom = {
      theme: 'report-jp',
      report_settings: { callout_labels: { note: '', warning: '注意点' } },
    };
    expect(calloutLabel('note', 'ja', custom)).toBe('');
    expect(calloutLabel('warning', 'ja', custom)).toBe('注意点');
    expect(contentsTitle('ja', {})).toBe('目次');
    expect(contentsTitle('ja', { theme: 'report-jp' })).toBe('目 次');
    expect(
      contentsTitle('ja', { report_settings: { toc_title: 'もくじ' } }),
    ).toBe('もくじ');
  });
});

describe('appendix letters and numbering depth', () => {
  const body =
    '# Intro\n\n## Scope\n\n### Detail\n\n# Data\n{appendix=true}\n\n## Tables\n\n# More';

  it('continues plain section numbers through appendices unless letters are requested', () => {
    const numbers = (frontMatter: string) =>
      analyzeDocument(report(frontMatter, body)).outline.map((entry) =>
        headingPrefix(entry, 'ja').trim(),
      );
    expect(numbers('number_sections: true')).toEqual([
      '1',
      '1.1',
      '1.1.1',
      '2',
      '2.1',
      '3',
    ]);
    expect(
      numbers(
        'number_sections: true\nreport_settings:\n  appendix_numbering: letter',
      ),
    ).toEqual(['1', '1.1', '1.1.1', '付録 A', 'A.1', '付録 B']);
    expect(
      numbers(
        'number_sections: true\nreport_settings:\n  heading_numbering: chapter',
      ),
    ).toEqual(['第1章', '1.1', '1.1.1', '付録 A', 'A.1', '付録 B']);
    expect(
      numbers(
        'number_sections: true\nreport_settings:\n  heading_numbering: chapter\n  appendix_numbering: continue',
      ),
    ).toEqual(['第1章', '1.1', '1.1.1', '第2章', '2.1', '第3章']);
  });

  it('refers to a lettered appendix with the same wording as chapter numbering', () => {
    const document = report(
      'number_sections: true\nreport_settings:\n  appendix_numbering: letter',
      '# Intro\n\n# Data\n{#sec:data appendix=true}\n\n![Alt](a.png)\n{#fig:a caption="Frame"}',
    );
    const analysis = analyzeDocument(document);
    expect(analysis.labels.get('sec:data')?.referenceText).toBe('付録 A');
    // Continuous captions do not restart in an appendix.
    expect(analysis.labels.get('fig:a')?.number).toBe('1');
  });

  it('leaves levels below number_depth unnumbered without consuming a number', () => {
    const analysis = analyzeDocument(
      report(
        'number_sections: true\nreport_settings:\n  number_depth: 2',
        '# A\n\n## B\n\n### C\n\n### D\n\n## E',
      ),
    );
    expect(analysis.outline.map((entry) => entry.number)).toEqual([
      '1',
      '1.1',
      undefined,
      undefined,
      '1.2',
    ]);
  });
});
