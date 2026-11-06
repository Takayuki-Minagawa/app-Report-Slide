import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import {
  createBlankChapter,
  createReportProject,
  assembleReportProject,
  projectChapterDocument,
} from '@/src/project/model';
import { readReportProject, writeReportProject } from '@/src/project/archive';
import { validateDocumentData } from './validation';
import { analyzeDocument, reportOutline } from './semantics';
import {
  defaultReportSettings,
  resolveReportSettings,
  type ReportSettings,
} from './report-settings';

const settings: ReportSettings = {
  cover: true,
  heading_numbering: 'chapter',
  caption_numbering: 'chapter',
  toc_depth: 2,
  toc_page: true,
  toc_page_numbers: true,
  list_figures: true,
  list_tables: true,
  affiliation: '構造研究室',
  recipient: '提出先',
  report_number: 'R-2026-01',
};

describe('report formatting settings and persistence', () => {
  it('resolves legacy defaults without adding stored metadata and accepts partial settings', () => {
    const metadata = {};
    expect(resolveReportSettings(metadata)).toEqual(defaultReportSettings);
    expect(resolveReportSettings(metadata).toc_page_numbers).toBe(false);
    expect(metadata).toEqual({});
    expect(
      resolveReportSettings({ report_settings: { toc_depth: 3 } }),
    ).toEqual({ ...defaultReportSettings, toc_depth: 3 });
    expect(
      validateDocumentData(parseMarkdown('Body').document).metadata,
    ).not.toHaveProperty('report_settings');
  });

  it.each([true, false])(
    'round-trips optional actual page numbers (%s) without adding other settings',
    (tocPageNumbers) => {
      const document = parseMarkdown('Body').document;
      document.metadata.report_settings = {
        toc_page_numbers: tocPageNumbers,
      };
      const restored = parseMarkdown(serializeDocument(document)).document;
      expect(restored.metadata.report_settings).toEqual({
        toc_page_numbers: tocPageNumbers,
      });
      expect(
        validateDocumentData(JSON.parse(JSON.stringify(document))),
      ).toEqual(document);
    },
  );

  it('round-trips settings and per-heading options in Markdown and JSON', () => {
    const document = parseMarkdown(
      '# 付録\n{#app:data appendix=true toc=false}\n\n## 詳細\n{appendix=false toc=true}',
    ).document;
    document.metadata.report_settings = settings;
    const saved = serializeDocument(document);
    expect(saved).toContain('appendix=true');
    expect(saved).toContain('toc=false');
    const restored = parseMarkdown(saved).document;
    expect(restored.metadata.report_settings).toEqual(settings);
    expect(restored.children[0].attrs).toMatchObject({
      appendix: true,
      toc: false,
      label: 'app:data',
    });
    expect(serializeDocument(restored)).toBe(saved);
    expect(validateDocumentData(JSON.parse(JSON.stringify(document)))).toEqual(
      document,
    );
  });

  it.each([
    null,
    [],
    { cover: 'true' },
    { heading_numbering: 'book' },
    { caption_numbering: 'section' },
    { toc_depth: 0 },
    { toc_depth: 7 },
    { toc_depth: 1.5 },
    { toc_page: 1 },
    { toc_page_numbers: 'true' },
    { toc_page_numbers: null },
    { list_figures: null },
    { list_tables: 'yes' },
    { affiliation: 'a'.repeat(201) },
    { recipient: 'a'.repeat(201) },
    { report_number: 'a'.repeat(101) },
    { unknown: true },
  ])(
    'rejects invalid report settings in JSON and Front Matter: %j',
    (invalid) => {
      const document = parseMarkdown('Body').document;
      const malformed = {
        ...document,
        metadata: { ...document.metadata, report_settings: invalid },
      };
      expect(() => validateDocumentData(malformed)).toThrow();
      expect(() =>
        parseMarkdown(
          `---\ntype: report\nreport_settings: ${JSON.stringify(invalid)}\n---\n\nBody`,
        ),
      ).toThrow();
    },
  );

  it.each([
    '# H\n{toc=yes}',
    '# H\n{appendix=1}',
    '# H\n{toc=true toc=false}',
    'Body\n{toc=false}',
    '![Image](image.png)\n{appendix=true}',
  ])('rejects invalid heading attribute syntax: %s', (source) => {
    expect(() => parseMarkdown(source)).toThrow();
  });

  it('keeps report settings and heading options in project ZIP and shared chapter metadata', async () => {
    const document = parseMarkdown(
      '# Appendix\n{appendix=true toc=false}',
    ).document;
    document.metadata.report_settings = { cover: false };
    const project = createReportProject(document);
    project.metadata.report_settings = settings;
    expect(
      projectChapterDocument(project, project.chapters[0]).metadata
        .report_settings,
    ).toEqual(settings);
    const bytes = await writeReportProject(project, new Map());
    const file = new File([new Uint8Array(bytes)], 'report.kumi.zip');
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array(bytes).buffer,
    });
    const restored = (await readReportProject(file)).project;
    expect(restored.metadata.report_settings).toEqual(settings);
    expect(restored.chapters[0].document.metadata.report_settings).toEqual({
      cover: false,
    });
    expect(restored.chapters[0].document.children[0].attrs).toMatchObject({
      appendix: true,
      toc: false,
    });
  });

  it('recomputes chapter captions and appendix numbers after chapter reordering or exclusion', () => {
    const project = createReportProject(
      parseMarkdown(
        '# First\n{#sec:first}\n\n![First](first.svg)\n{#fig:first}',
      ).document,
    );
    project.metadata.number_sections = true;
    project.metadata.report_settings = settings;
    project.chapters.push({
      ...createBlankChapter(2),
      document: parseMarkdown(
        '# Second\n{#sec:second}\n\n![Second](second.svg)\n{#fig:second}',
      ).document,
    });
    project.chapters.push({
      ...createBlankChapter(3),
      document: parseMarkdown(
        '# Appendix\n{#app:data appendix=true}\n\n![Appendix](appendix.svg)\n{#fig:appendix}',
      ).document,
    });
    let analysis = analyzeDocument(assembleReportProject(project));
    expect(analysis.labels.get('fig:second')?.number).toBe('2.1');
    expect(analysis.labels.get('fig:appendix')?.number).toBe('A.1');
    [project.chapters[0], project.chapters[1]] = [
      project.chapters[1],
      project.chapters[0],
    ];
    analysis = analyzeDocument(assembleReportProject(project));
    expect(analysis.labels.get('fig:second')?.number).toBe('1.1');
    expect(analysis.labels.get('fig:first')?.number).toBe('2.1');
    project.chapters[1].enabled = false;
    analysis = analyzeDocument(assembleReportProject(project));
    expect(analysis.labels.has('fig:first')).toBe(false);
    expect(analysis.labels.get('app:data')?.number).toBe('A');
    project.chapters[2].enabled = false;
    expect(reportOutline(assembleReportProject(project))).toHaveLength(1);
  });
});
