import { z } from 'zod';

export const blockRoles = [
  'body',
  'lead',
  'figureLabel',
  'source',
  'conclusion',
  'note',
] as const;
export const blockLayoutSchema = z.strictObject({
  name: z.string().max(120).optional(),
  groupId: z.string().min(1).max(128).optional(),
  locked: z.boolean().optional(),
  role: z.enum(blockRoles).optional(),
});
export type BlockLayout = z.infer<typeof blockLayoutSchema>;
export function readBlockLayout(value: unknown): BlockLayout {
  const result = blockLayoutSchema.safeParse(value);
  return result.success ? result.data : {};
}
