import sans from './fonts/KumiPrintSansJP.woff2?inline';
import serif from './fonts/KumiPrintSerifJP.woff2?inline';
import sansLicense from './fonts/OFL-Sans.txt?raw';
import serifLicense from './fonts/OFL-Serif.txt?raw';

/** Local fonts avoid OS-dependent CJK-to-radical substitutions in PDF text maps. */
const notices = `${sansLicense}\n${serifLicense}`.replaceAll('*/', '* /');
export const offlinePrintFonts = `
/* ${notices} */
@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:100 900;font-display:block;src:url(${sans}) format('woff2')}
@font-face{font-family:'Noto Serif JP';font-style:normal;font-weight:200 900;font-display:block;src:url(${serif}) format('woff2')}
`;
