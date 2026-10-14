import { z } from 'zod';
import type { DocumentMetadata, DocumentNode } from './model';
import { figureReferencesSchema } from './figure-edit';
import { slideCompositeSchema } from './slide-design';

/** Node semantics are also checked by validateDocumentData; no executable content is stored. */
export const blockLibrarySchema = z
  .strictObject({
    version: z.literal(1),
    items: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(128),
          name: z.string().min(1).max(120),
          nodes: z
            .array(
              z.custom<DocumentNode>(
                (value) =>
                  !!value &&
                  typeof value === 'object' &&
                  'type' in value &&
                  'attrs' in value,
              ),
            )
            .min(1)
            .max(500),
          composite: slideCompositeSchema.optional(),
          references: figureReferencesSchema.optional(),
        }),
      )
      .max(10000),
  })
  .refine(
    (library) =>
      new Set(library.items.map((item) => item.id)).size ===
      library.items.length,
    '部品IDが重複しています',
  );
export type BlockLibrary = z.infer<typeof blockLibrarySchema>;
export type BlockLibraryItem = BlockLibrary['items'][number];
export function readBlockLibrary(metadata: DocumentMetadata): BlockLibrary {
  const result = blockLibrarySchema.safeParse(metadata.block_library);
  return result.success ? result.data : { version: 1, items: [] };
}
