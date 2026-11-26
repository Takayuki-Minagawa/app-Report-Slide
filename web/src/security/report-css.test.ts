import { describe, expect, it } from 'vitest';
import {
  maximumReportCssLength,
  reportCssIssues,
  safeReportCss,
} from './report-css';

describe('document style sheet validation', () => {
  it('accepts ordinary declarations, page rules, escapes in strings and media queries', () => {
    for (const css of [
      '.report-preview[data-theme] .document-renderer h1 { font-size: 14pt; }',
      ".kumi-physical-footer::before { content: '- '; }",
      "h2::after { content: '\\2014 a{b' }",
      '@media print { p { color: #000 } }',
      '@page { @bottom-center { content: counter(page) } }',
      'li[style*="padding-left: 0px"] { scroll-behavior: smooth }',
      '/* a } comment */ p { margin: 0 }',
      '',
    ])
      expect(reportCssIssues(css), css).toEqual([]);
  });

  it.each([
    ['@import "https://example.com/a.css";'],
    ['@IMPORT url(a.css);'],
    ['p { background: url(https://example.com/x.png) }'],
    ['p { background: u\\72l(https://example.com/x.png) }'],
    ['p { background: \\75\\72\\6c(https://example.com/x.png) }'],
    ['p { background: URL (x) }'],
    ['p { background: image-set("https://example.com/x.png" 1x) }'],
    ['p { background: -webkit-image-set("x" 1x) }'],
    ['@font-face { font-family: x; src: local(x) }'],
    ['@namespace svg "http://www.w3.org/2000/svg";'],
    ['p { width: expression(alert(1)) }'],
    ['p { behavior: none }'],
    ['p { -moz-binding: none }'],
    ['</style><script>alert(1)</script>'],
    ["p::before { content: '</style>' }"],
    ['p { color: red } } body { display: none } .x {'],
    ['p { color: red'],
    ['p { content: "unterminated }'],
    ['/* unterminated'],
    ['html:has(&) header { display: none }'],
    ['& + div { display: none }'],
    ['@scope (body) { header { display: none } }'],
    ['@keyframes x { from { opacity: 0 } }'],
    ['@property --x { syntax: "*"; inherits: false }'],
    ['p { color: red }\\'],
    ['p { color: red }\u0000'],
  ])('rejects %s', (css) => {
    expect(reportCssIssues(css)).not.toEqual([]);
    expect(safeReportCss(css)).toBe('');
  });

  it('limits the length and requires a string', () => {
    expect(reportCssIssues('a'.repeat(maximumReportCssLength))).toEqual([]);
    expect(reportCssIssues('a'.repeat(maximumReportCssLength + 1))).not.toEqual(
      [],
    );
    expect(reportCssIssues(1)).not.toEqual([]);
    expect(safeReportCss(undefined)).toBe('');
  });
});
