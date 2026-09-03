import katexCss from 'katex/dist/katex.min.css?raw';
import font0 from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline';
import font1 from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline';
import font2 from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline';
import font3 from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline';
import font4 from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline';
import font5 from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?inline';
import font6 from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline';
import font7 from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?inline';
import font8 from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?inline';
import font9 from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline';
import font10 from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?inline';
import font11 from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline';
import font12 from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline';
import font13 from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline';
import font14 from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?inline';
import font15 from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline';
import font16 from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline';
import font17 from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline';
import font18 from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline';
import font19 from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline';

const fonts: Record<string, string> = {
  'KaTeX_AMS-Regular': font0,
  'KaTeX_Caligraphic-Bold': font1,
  'KaTeX_Caligraphic-Regular': font2,
  'KaTeX_Fraktur-Bold': font3,
  'KaTeX_Fraktur-Regular': font4,
  'KaTeX_Main-Bold': font5,
  'KaTeX_Main-BoldItalic': font6,
  'KaTeX_Main-Italic': font7,
  'KaTeX_Main-Regular': font8,
  'KaTeX_Math-BoldItalic': font9,
  'KaTeX_Math-Italic': font10,
  'KaTeX_SansSerif-Bold': font11,
  'KaTeX_SansSerif-Italic': font12,
  'KaTeX_SansSerif-Regular': font13,
  'KaTeX_Script-Regular': font14,
  'KaTeX_Size1-Regular': font15,
  'KaTeX_Size2-Regular': font16,
  'KaTeX_Size3-Regular': font17,
  'KaTeX_Size4-Regular': font18,
  'KaTeX_Typewriter-Regular': font19,
};

/** Replace every font-face source with its embedded WOFF2 font. */
// Minified CSS may omit the final semicolon: never consume the next rule.
export const offlineMathStyles = katexCss.replace(/src:[^;}]+;?/g, (source) => {
  const name = /fonts\/(KaTeX_[\w-]+)\.woff2/.exec(source)?.[1];
  const dataUrl = name && fonts[name];
  if (!dataUrl) throw new Error('Missing bundled KaTeX font');
  return 'src:url(' + dataUrl + ') format("woff2");';
});
