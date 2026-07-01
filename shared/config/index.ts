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
  // Stripe — all OPTIONAL. Without them the app boots and card payments simply self-disable
  // (manual cash/check/terminal payments still work). Card create needs the secret key +
  // PUBLIC_APP_URL (for hosted-checkout redirects); the webhook needs the signing secret.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PUBLIC_APP_URL: z.url().optional(),
  // Comms providers — all OPTIONAL. Each channel independently falls back to the logging stub when
  // unconfigured (graceful degradation). Email needs RESEND_API_KEY + EMAIL_FROM; SMS needs all
  // three Twilio vars. ANTHROPIC_API_KEY unblocks the Phase 3 AI features.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(), // e.g. "Mallet <notifications@yourdomain.com>"
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Shared secret guarding the outbox relay cron route. Optional — the route 503s (fail-closed)
  // when unset, so the relay never runs unauthenticated. Vercel Cron sends it as a Bearer token.
  // preprocess "" -> undefined so a blank env var (a common Vercel misconfig) degrades to the
  // fail-closed 503 path instead of failing schema validation and 500-ing the ENTIRE app at boot.
  CRON_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(16).optional()),
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
