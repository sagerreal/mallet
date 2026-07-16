import { z } from "zod";

// Single safeParse per validation boundary — used by all agent tools so the parse pattern is
// consistent and DRY across fingerprint and handle methods.
export function parseTool<T>(schema: z.ZodType<T>, raw: unknown): z.ZodSafeParseResult<T> {
  return schema.safeParse(raw);
}
