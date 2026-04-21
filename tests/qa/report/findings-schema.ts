import { z } from 'zod';

export const FindingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(['func','stab','a11y','seo','ux','design','sec','perf']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  severity: z.enum(['P0','P1','P2']),
  surface: z.enum(['dashboard','website']),
  what: z.string(),
  where: z.string(),
  repro: z.array(z.string()).optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  test: z.string().optional(),
  screenshot: z.string().optional(),
  suggestedFix: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);
