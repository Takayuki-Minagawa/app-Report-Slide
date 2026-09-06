import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import {
  createReportProject,
  assembleReportProject,
} from '@/src/project/model';
import { readReportProject, writeReportProject } from '@/src/project/archive';
import { parseWorkspaceRecovery } from '@/src/workspace/recovery';
import { DocumentValidationError, validateDocumentData } from './validation';
import {
  defaultPageSettings,
  resolvePageSettings,
  pageDimensions,
  type PageSettings,
} from './page-settings';

const settings: PageSettings = {
  ...defaultPageSettings,
  paper: 'B5',
  orientation: 'landscape',
  margin_top: 12,
  margin_bottom: 14,
  margin_left: 16,
  margin_right: 18,
  font_size: 12,
  line_height: 1.5,
  first_line_indent: 1,
  paragraph_spacing: 6,
};

function report() {
  const document = parseMarkdown('# Report\n\nBody paragraph.').document;
  document.metadata.page_settings = { ...settings };
  return document;
}

describe('report page settings persistence', () => {
  it('preserves every setting in Markdown and JSON without changing the body', () => {
    const document = report();
    const markdown = parseMarkdown(serializeDocument(document)).document;
    const json = validateDocumentData(JSON.parse(JSON.stringify(document)));
    expect(markdown.metadata.page_settings).toEqual(settings);
    expect(json).toEqual(document);
    expect(serializeDocument(markdown)).toEqual(serializeDocument(document));
  });

  it('retains legacy metadata and resolves defaults without migrating the source', () => {
    const metadata = {
      paper: 'A5',
      orientation: 'landscape',
      custom: 'keep me',
    };
    expect(resolvePageSettings(metadata)).toEqual({
      ...defaultPageSettings,
      paper: 'A5',
      orientation: 'landscape',
    });
    expect(metadata).not.toHaveProperty('page_settings');
    expect(pageDimensions(resolvePageSettings(metadata))).toEqual([210, 148]);
    expect(resolvePageSettings({ paper: 'Custom' }).paper).toBe('A4');
  });

  it.each([
    { line_height: 0 },
    { line_height: 4 },
    { font_size: '12' },
    { first_line_indent: -1 },
    { margin_top: 71 },
    { paper: 'unknown' },
    { orientation: 'up' },
    { paragraph_spacing: null },
    { paper: 'A5', orientation: 'portrait', margin_left: 60, margin_right: 60 },
    { extra: 'unsupported' },
  ])('rejects invalid settings in both input formats: %j', (patch) => {
    const original = report();
    const document = {
      ...original,
      metadata: {
        ...original.metadata,
        page_settings: { ...settings, ...patch },
      },
    };
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
    const source = `---\ntype: report\npage_settings: ${JSON.stringify(document.metadata.page_settings)}\n---\n\n# Body`;
    expect(() => parseMarkdown(source)).toThrow();
  });

  it('saves project-wide settings independently from chapter settings in ZIP', async () => {
    const project = createReportProject(report());
    const globalSettings = {
      ...settings,
      line_height: 2,
      paper: 'A3' as const,
    };
    project.metadata.page_settings = globalSettings;
    const bytes = await writeReportProject(project, new Map());
    const file = new File([new Uint8Array(bytes)], 'report.kumi.zip');
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array(bytes).buffer,
    });
    const loaded = await readReportProject(file);
    expect(loaded.project.metadata.page_settings).toEqual(globalSettings);
    expect(loaded.project.chapters[0].document.metadata.page_settings).toEqual(
      settings,
    );
    expect(
      assembleReportProject(loaded.project).metadata.page_settings,
    ).toEqual(globalSettings);
  });

  it('retains settings in recovery copies and rejects damaged copies', () => {
    const document = report();
    const recovery = {
      schemaVersion: 1,
      savedAt: 100,
      document,
      markdownDraft: '',
      markdownDirty: false,
      view: 'visual',
      assets: [],
    };
    expect(
      parseWorkspaceRecovery(recovery)?.document.metadata.page_settings,
    ).toEqual(settings);
    document.metadata.page_settings = { ...settings, line_height: -1 };
    expect(() =>
      validateDocumentData(parseWorkspaceRecovery(recovery)!.document),
    ).toThrow(DocumentValidationError);
  });
});
