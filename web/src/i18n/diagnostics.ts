import type { SemanticTarget } from '@/src/document/semantics';
import type { MarkdownDiagnostic } from '@/src/markdown/diagnostics';
import type { AppLocale } from './messages';

const japaneseCharacter = /[ぁ-んァ-ン一-龠]/;

const diagnosticByCode: Record<string, string> = {
  'frontmatter.missing':
    'No Front Matter was found; the fallback document type was used.',
  'frontmatter.unclosed': 'A closing Front Matter delimiter (---) is required.',
  'frontmatter.invalid-yaml':
    'Front Matter YAML is invalid. Check its syntax and values.',
  'frontmatter.unsafe': 'Front Matter could not be safely read.',
  'frontmatter.not-object':
    'Front Matter must be a mapping of keys and values.',
  'frontmatter.unsupported-value':
    'Front Matter contains an unsupported value.',
  'frontmatter.type-missing':
    'The document type is missing; the fallback document type was used.',
  'frontmatter.type-invalid': 'The document type must be report or slide.',
  'frontmatter.metadata-type-invalid':
    'A Front Matter value has an invalid type.',
  'markdown.image-url-unsafe': 'An unsafe image URL was rejected.',
  'markdown.link-url-unsafe': 'An unsafe link URL was rejected.',
  'markdown.attributes-invalid':
    'An element attribute line is invalid. Check its syntax and values.',
  'markdown.break-invalid':
    'A page or slide break must be a top-level ::: pagebreak or ::: slidebreak block.',
  'markdown.token-ignored': 'An unsupported Markdown element was ignored.',
};

const exactMessages: Record<string, string> = {
  文書データの形式が正しくありません: 'The document data is invalid.',
  Markdownを安全に読み込めませんでした: 'Markdown could not be safely read.',
  'Front Matterが閉じられていません': 'Front Matter is not closed.',
  'Front MatterのYAMLが正しくありません': 'Front Matter YAML is invalid.',
  'Front Matterを安全に読み込めませんでした':
    'Front Matter could not be safely read.',
  'Front Matterはキーと値で記述してください':
    'Front Matter must contain keys and values.',
  'Front Matterに対応していない値があります':
    'Front Matter contains an unsupported value.',
  文書種類が正しくありません: 'The document type is invalid.',
  'Front Matterの値の型が正しくありません':
    'A Front Matter value has an invalid type.',
};

export function localizeDiagnosticMessage(
  message: string,
  locale: AppLocale,
): string {
  if (locale === 'ja') return message;

  const duplicate = message.match(/^ラベル「(.+)」が重複しています。$/);
  if (duplicate) return `The reference label "${duplicate[1]}" is duplicated.`;

  const unresolved = message.match(
    /^参照「(.+)」の対象が見つからないか、ラベルが重複しています。$/,
  );
  if (unresolved)
    return `The reference "${unresolved[1]}" is missing or duplicated.`;

  if (exactMessages[message]) return exactMessages[message];
  return japaneseCharacter.test(message)
    ? 'A document validation issue was found. Check the source and try again.'
    : message;
}

export function localizeMarkdownDiagnostic(
  diagnostic: Pick<MarkdownDiagnostic, 'code' | 'message'>,
  locale: AppLocale,
): string {
  if (locale === 'ja') return diagnostic.message;
  return (
    diagnosticByCode[diagnostic.code] ??
    localizeDiagnosticMessage(diagnostic.message, locale)
  );
}

export function formatSemanticReference(
  target: SemanticTarget,
  locale: AppLocale,
): string {
  const prefix =
    locale === 'en'
      ? {
          heading: 'Section',
          figure: 'Figure',
          table: 'Table',
          blockMath: 'Equation',
        }[target.type]
      : {
          heading: '節',
          figure: '図',
          table: '表',
          blockMath: '式',
        }[target.type];

  if (target.number) return `${prefix} ${target.number}`;
  return (
    target.title ||
    (locale === 'en'
      ? `Unnumbered ${prefix.toLowerCase()}`
      : `${prefix}（番号なし）`)
  );
}
