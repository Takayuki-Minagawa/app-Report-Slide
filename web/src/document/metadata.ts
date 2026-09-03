import type { DocumentType } from './model';

export const stringMetadataKeys: ReadonlySet<string> = new Set([
  'title',
  'subtitle',
  'author',
  'date',
  'paper',
  'orientation',
  'theme',
  'aspect_ratio',
]);
export const documentFlags = [
  'toc',
  'number_sections',
  'slide_number',
] as const;
export type DocumentFlag = (typeof documentFlags)[number];
export const booleanMetadataKeys: ReadonlySet<string> = new Set(documentFlags);

export const documentThemes = {
  report: [
    ['latex', 'LaTeX'],
    ['calculation', 'Calculation'],
  ],
  slide: [
    ['beamer-simple', 'Beamer Simple'],
    ['technical', 'Technical'],
  ],
} as const satisfies Record<
  DocumentType,
  readonly (readonly [string, string])[]
>;

export function resolveDocumentTheme(
  type: DocumentType,
  requested?: unknown,
): string {
  return (
    documentThemes[type].find(([value]) => value === requested)?.[0] ??
    documentThemes[type][0][0]
  );
}
