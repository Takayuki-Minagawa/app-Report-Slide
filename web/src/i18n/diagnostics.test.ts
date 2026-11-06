import { describe, expect, it } from 'vitest';

import type { SemanticTarget } from '@/src/document/semantics';
import {
  formatSemanticReference,
  formatHeadingNumber,
  localizeDiagnosticMessage,
  localizeMarkdownDiagnostic,
} from './diagnostics';

describe('diagnostics localization', () => {
  it('formats chapter and appendix headings and references in both languages', () => {
    const target: SemanticTarget = {
      type: 'heading',
      nodeId: 'h',
      number: '2',
      title: 'Title',
      referenceText: '',
      headingKind: 'chapter',
    };
    expect(formatHeadingNumber(target, 'ja')).toBe('第2章');
    expect(formatSemanticReference(target, 'en')).toBe('Chapter 2');
    expect(
      formatSemanticReference(
        { ...target, headingKind: 'appendix', number: 'A' },
        'ja',
      ),
    ).toBe('付録 A');
    expect(
      formatHeadingNumber(
        { ...target, headingKind: 'appendix', number: 'A' },
        'en',
      ),
    ).toBe('Appendix A');
    expect(
      formatHeadingNumber(
        { ...target, headingKind: 'section', number: '2.1' },
        'ja',
      ),
    ).toBe('2.1');
    expect(
      formatSemanticReference(
        { ...target, headingKind: 'section', number: '2.1' },
        'en',
      ),
    ).toBe('Section 2.1');
    expect(formatHeadingNumber({ ...target, number: undefined }, 'ja')).toBe(
      '',
    );
    expect(
      formatSemanticReference({ ...target, number: undefined }, 'en'),
    ).toBe('Title');
  });
  it.each(['constructor', '__proto__', 'toString'])(
    'keeps an unknown diagnostic named %s as text',
    (value) => {
      expect(localizeDiagnosticMessage(value, 'en')).toBe(value);
      expect(
        localizeMarkdownDiagnostic(
          { code: value, message: 'Unknown diagnostic' },
          'en',
        ),
      ).toBe('Unknown diagnostic');
    },
  );

  it('translates parser diagnostics by stable code', () => {
    expect(
      localizeMarkdownDiagnostic(
        {
          code: 'frontmatter.type-invalid',
          message: 'typeには report または slide を指定してください',
        },
        'en',
      ),
    ).toBe('The document type must be report or slide.');
  });

  it('translates semantic reference diagnostics and generated labels', () => {
    const figure: SemanticTarget = {
      type: 'figure',
      nodeId: 'figure-1',
      number: '2',
      title: 'Response',
      referenceText: '図 2',
    };

    expect(
      localizeDiagnosticMessage(
        'ラベル「fig:response」が重複しています。',
        'en',
      ),
    ).toBe('The reference label "fig:response" is duplicated.');
    expect(formatSemanticReference(figure, 'ja')).toBe('図 2');
    expect(formatSemanticReference(figure, 'en')).toBe('Figure 2');
  });
});
