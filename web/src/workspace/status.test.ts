import { describe, expect, it } from 'vitest';
import { messages } from '@/src/i18n/messages';
import { MarkdownImportError } from '@/src/markdown/diagnostics';
import { MarkdownSerializationError } from '@/src/markdown/serializer';
import { describeWorkspaceError, statusDescriptionText } from './status';

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
});
