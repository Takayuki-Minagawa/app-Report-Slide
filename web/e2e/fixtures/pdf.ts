import { jsPDF } from 'jspdf';

/** Generated locally: distinct pages make the selected page and orientation observable. */
export function twoPagePdfFixture(
  options: { password?: string; script?: string } = {},
) {
  const pdf = new jsPDF({
    unit: 'pt',
    format: 'a4',
    ...(options.password
      ? {
          encryption: {
            userPassword: options.password,
            ownerPassword: 'fixture-owner',
          },
        }
      : {}),
  });
  pdf.setFontSize(28);
  pdf.text('PDF page 1 - original evidence', 36, 64);
  pdf.setFillColor(37, 99, 235);
  pdf.rect(36, 110, 210, 160, 'F');
  pdf.addPage('a4', 'landscape');
  pdf.setFontSize(28);
  pdf.text('PDF page 2 - comparison', 36, 64);
  pdf.setFillColor(220, 38, 38);
  pdf.circle(180, 200, 80, 'F');
  if (options.script) pdf.addJS(options.script);
  return Buffer.from(pdf.output('arraybuffer'));
}
