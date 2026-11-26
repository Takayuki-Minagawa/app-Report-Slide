import { describe, expect, it } from 'vitest';
import { latexToOmml } from './math';

const body = (latex: string, display = true) =>
  latexToOmml(latex, display)
    .replace(/^<m:oMath[^>]*>/, '')
    .replace(/<\/m:oMath>$/, '')
    .replaceAll(
      '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>',
      '',
    )
    .replaceAll(' xml:space="preserve"', '');

describe('LaTeX to Word equations (OMML)', () => {
  it('produces well-formed XML in the math namespace', () => {
    const xml = latexToOmml(
      'R = \\frac{\\delta_i}{h_i} \\le \\frac{1}{100}',
      true,
    );
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(parsed.documentElement.namespaceURI).toBe(
      'http://schemas.openxmlformats.org/officeDocument/2006/math',
    );
  });

  it('converts fractions, scripts and roots to their Word structures', () => {
    expect(body('\\frac{a}{b}')).toBe(
      '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>',
    );
    expect(body('x_i^2')).toBe(
      '<m:sSubSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSubSup>',
    );
    expect(body('\\sqrt{x}')).toBe(
      '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>',
    );
    expect(body('\\sqrt[3]{x}')).toContain(
      '<m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg>',
    );
    expect(body('\\binom{n}{k}')).toContain('<m:type m:val="noBar"/>');
  });

  it('gives sums and integrals their limits and the following operand', () => {
    const sum = body('\\sum_{i=1}^{n} x_i');
    expect(sum).toMatch(
      /^<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*<\/m:sub><m:sup>.*<\/m:sup><m:e><m:sSub>.*<\/m:sSub><\/m:e><\/m:nary>$/,
    );
    expect(body('\\int_0^1 f')).toContain('<m:limLoc m:val="subSup"/>');
    expect(body('\\sum x')).toContain(
      '<m:subHide m:val="1"/><m:supHide m:val="1"/>',
    );
  });

  it('keeps stretchy delimiters, matrices, accents and upright names', () => {
    expect(body('\\left( \\frac{a}{b} \\right)')).toMatch(
      /^<m:d><m:dPr><m:begChr m:val="\("\/><m:endChr m:val="\)"\/><\/m:dPr><m:e><m:f>/,
    );
    expect(body('\\left. x \\right|')).toContain('<m:begChr m:val=""/>');
    const matrix = body('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(matrix.match(/<m:mr>/g)).toHaveLength(2);
    expect(matrix.match(/<m:mc>/g)).toHaveLength(2);
    expect(body('\\hat{x}')).toContain(
      '<m:acc><m:accPr><m:chr m:val="\u0302"/>',
    );
    expect(body('\\vec{v}')).toContain('<m:chr m:val="\u20d7"/>');
    expect(body('\\overline{x}')).toContain('<m:pos m:val="top"/>');
    expect(body('\\sin x')).toContain(
      '<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r>',
    );
    expect(body('\\mathbf{K}')).toContain('<m:sty m:val="b"/>');
    expect(body('\\text{kN} < 5 \\& a')).toContain(
      '<m:r><m:rPr><m:nor/></m:rPr><m:t>kN</m:t></m:r>',
    );
    expect(body('a < b')).toContain('<m:t>&lt;</m:t>');
  });

  it('keeps letter styles Word has and refuses what it cannot express', () => {
    expect(body('\\mathbb{R}')).toContain(
      '<m:rPr><m:scr m:val="double-struck"/><m:sty m:val="p"/></m:rPr><m:t>R</m:t>',
    );
    expect(body('\\mathcal{L}')).toContain('<m:scr m:val="script"/>');
    expect(body('\\mathfrak{g}')).toContain('<m:scr m:val="fraktur"/>');
    // Negative thin space leaves no visible gap.
    expect(body('a\\!b')).toBe(
      '<m:r><m:t>a</m:t></m:r><m:r><m:t>b</m:t></m:r>',
    );
    for (const latex of [
      '\\cancel{x}',
      'a \\\\ b',
      'a = b \\tag{3}',
      '\\htmlClass{a}{b}',
      '\\href{https://example.com}{x}',
      '\\stackrel{def}{=}',
    ])
      expect(() => latexToOmml(latex, true), latex).toThrow();
  });

  it('converts environments that only exist in display mode', () => {
    expect(
      latexToOmml('\\begin{align} a &= b \\\\ c &= d \\end{align}', true),
    ).toContain('<m:m>');
    // Sums take limits above and below in a display equation.
    expect(body('\\sum_{i=1}^{n} x_i', true)).toContain(
      '<m:limLoc m:val="undOvr"/>',
    );
  });

  it('rejects invalid LaTeX instead of writing a wrong equation', () => {
    expect(() => latexToOmml('\\frac{a}{', true)).toThrow();
    expect(() => latexToOmml('\\notacommand{x}', true)).toThrow();
  });

  it.each([
    '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
    '\\underbrace{a+b}_{n}',
    '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
    '\\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}',
    'M = \\sqrt{M_x^2 + M_y^2}',
    '\\boxed{E = mc^2}',
    '{}^{14}_{6}\\mathrm{C}',
    '\\dot{u} + \\ddot{u} + \\tilde{a} + \\bar{b}',
    '\\alpha \\cdot \\beta \\times 10^{-3}\\ \\mathrm{kN/m^2}',
    'K\\,u = F \\quad (i = 1, \\dots, n)',
  ])('converts %s to well-formed OMML', (latex) => {
    const parsed = new DOMParser().parseFromString(
      latexToOmml(latex, true),
      'application/xml',
    );
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  });
});
