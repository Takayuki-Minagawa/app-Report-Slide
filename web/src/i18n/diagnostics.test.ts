import { describe, expect, it } from 'vitest';

import type { SemanticTarget } from '@/src/document/semantics';
import {
  formatSemanticReference,
  localizeDiagnosticMessage,
  localizeMarkdownDiagnostic,
} from './diagnostics';

describe('diagnostics localization', () => {
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
