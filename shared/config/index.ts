import { z } from "zod";

// Validated, environment-specific configuration. Fails fast at boot on a missing/malformed value
// (a misconfiguration is a programmer/ops error, not a runtime condition to degrade through).
// Server-only — contains secrets (service-role key, DB url). Never import from a client component.
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Owner connection (migrations / DDL). The `postgres` role has BYPASSRLS, so it is
  // NEVER used for tenant-scoped runtime queries.
  DATABASE_URL: z.string().min(1),
  // Runtime connection as the least-privilege `mallet_app` role (NOBYPASSRLS). All
  // tenant data access goes through this so RLS is always enforced.
  APP_DATABASE_URL: z.string().min(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new Error(`Invalid or missing configuration: ${fields}`);
  }
  return parsed.data;
};
