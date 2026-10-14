import { z } from 'zod';
import type { DocumentMetadata } from './model';

const asset = z.strictObject({
  source: z.string().min(1).max(2000),
  kind: z.enum(['image', 'pdf']),
});
export const preservedContentSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(128),
      nodeId: z.string().max(512).optional(),
      name: z.string().min(1).max(1000),
      format: z.enum(['json', 'html']),
      source: z.string().max(5 * 1024 * 1024),
      assets: z.array(asset).max(1000).optional(),
    }),
  )
  .max(1000)
  .refine((entries) => {
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const entry of entries) {
      bytes += encoder.encode(entry.source).byteLength;
      if (bytes > 5 * 1024 * 1024) return false;
    }
    return true;
  }, '保持する原データは合計5 MiBまでです。');

export type PreservedContent = z.infer<typeof preservedContentSchema>[number];

export function preservedContent(
  metadata: DocumentMetadata,
): PreservedContent[] {
  const result = preservedContentSchema.safeParse(
    metadata.preserved_content ?? [],
  );
  return result.success ? result.data : [];
}

export function preservedContentAssets(metadata: DocumentMetadata) {
  return preservedContent(metadata).flatMap((entry) => entry.assets ?? []);
}
