import { describe, expect, it } from 'vitest';
import { messages } from '@/src/i18n/messages';
import { MarkdownImportError } from '@/src/markdown/diagnostics';
import { MarkdownSerializationError } from '@/src/markdown/serializer';
import {
  describeWorkspaceError,
  describeExportError,
  isExportModuleLoadError,
  statusDescriptionText,
} from './status';

describe('workspace error descriptions', () => {
  it('preserves a parse diagnostic without incorrectly recommending JSON export', () => {
    const error = new MarkdownImportError('文書種類が正しくありません', [
      {
        severity: 'error',
        code: 'frontmatter.type-invalid',
        message: 'typeには report または slide を指定してください',
      },
    ]);
    const description = describeWorkspaceError(error, 'unableToParseMarkdown');
    const english = statusDescriptionText(description, messages.en, 'en');
    expect(english).toBe('The document type must be report or slide.');
    expect(english).not.toContain(messages.en.status.markdownUnsupported);
    expect(statusDescriptionText(description, messages.ja, 'ja')).toContain(
      'typeには',
    );
  });

  it('explains unsupported Markdown constructs and retains the JSON fallback', () => {
    const description = describeWorkspaceError(
      new MarkdownSerializationError(
        'markdown.table-multiple-blocks',
        '表のセル内は1つの段落にしてください',
      ),
      'unableToSerialize',
    );
    const english = statusDescriptionText(description, messages.en, 'en');
    expect(english).toContain(
      'Markdown tables require one paragraph per cell.',
    );
    expect(english).toContain(messages.en.status.markdownUnsupported);
  });

  it('does not misclassify download failures as unsupported Markdown', () => {
    const description = describeWorkspaceError(
      new Error('Download unavailable'),
      'unableToSerialize',
    );
    expect(statusDescriptionText(description, messages.en, 'en')).toBe(
      'Download unavailable',
    );
  });

  it.each([
    'Failed to fetch dynamically imported module: https://example.com/export-old.js',
    'error loading dynamically imported module: https://example.com/export-old.js',
    'Importing a module script failed.',
    'Loading chunk 123 failed.',
    'Unable to preload CSS for https://example.com/export-old.css',
  ])('recognizes export module loading failures: %s', (message) => {
    const error = new TypeError(message);
    expect(isExportModuleLoadError(error)).toBe(true);
    for (const locale of ['ja', 'en'] as const) {
      const copy = messages[locale];
      const confirmed = statusDescriptionText(
        describeExportError(error, 'unableToExportHtml', true),
        copy,
        locale,
      );
      expect(confirmed).toContain(copy.status.exportModuleUnavailable);
      expect(confirmed).toContain(copy.status.exportRecoverySaved);
      expect(confirmed).not.toContain('export-old');
      const unconfirmed = statusDescriptionText(
        describeExportError(error, 'unableToExportHtml', false),
        copy,
        locale,
      );
      expect(unconfirmed).toContain(copy.status.exportRecoveryUnconfirmed);
      expect(unconfirmed).not.toContain(copy.status.exportRecoverySaved);
    }
  });

  it('does not suggest recovery for unrelated network or conversion errors', () => {
    for (const message of ['Failed to fetch', 'Unreadable image']) {
      const error = new Error(message);
      expect(isExportModuleLoadError(error)).toBe(false);
      expect(
        statusDescriptionText(
          describeExportError(error, 'unableToExportHtml', true),
          messages.en,
          'en',
        ),
      ).toBe(message);
    }
  });
});
