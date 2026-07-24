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
  // Optional override for the URL used in Twilio HMAC signature verification. Behind proxies that
  // don't forward X-Forwarded-* headers, req.url may not match the externally-reachable URL that
  // Twilio signed against. Set this to EXACTLY the webhook URL configured in the Twilio console
  // (e.g. "https://trymallet.com/api/webhooks/twilio"). Vercel provides X-Forwarded-* so
  // req.url is correct there and this can be left unset.
  TWILIO_WEBHOOK_URL: z.url().optional(),
  // A2P 10DLC ISV registration. Both optional: without the primary profile SID the A2pGateway
  // degrades to a logging stub (dev/test boot without secrets). The status callback is where Twilio
  // posts async brand/campaign approval results (see app/api/webhooks/twilio-a2p/route.ts).
  TWILIO_PRIMARY_PROFILE_SID: z.string().min(1).optional(),
  TWILIO_A2P_STATUS_CALLBACK_URL: z.url().optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Vapi (AI voice front desk) — all OPTIONAL. Without VAPI_WEBHOOK_SECRET the /api/frontdesk/vapi
  // route fail-closes (503, feature dark), so calls are never answered unverified. The secret is the
  // shared string sent as the x-vapi-secret header (min 16 for real entropy). VAPI_API_KEY is the
  // dashboard key for future programmatic assistant/number setup — unused by the webhook path.
  VAPI_WEBHOOK_SECRET: z.string().min(16).optional(),
  VAPI_API_KEY: z.string().min(1).optional(),
  // Shared secret guarding the outbox relay cron route. Optional — the route 503s (fail-closed)
  // when unset, so the relay never runs unauthenticated. Vercel Cron sends it as a Bearer token.
  // preprocess "" -> undefined so a blank env var (a common Vercel misconfig) degrades to the
  // fail-closed 503 path instead of failing schema validation and 500-ing the ENTIRE app at boot.
  CRON_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(16).optional()),
  // QuickBooks Online (Intuit). All OPTIONAL: without a client id/secret the QBO gateway degrades
  // to a disabled stub and the Settings card says "not configured" rather than 500-ing the app.
  // Development keys are sandbox-only — Intuit blocks them against live QBO companies — so the
  // environment switch picks the API host, not just a label.
  QBO_CLIENT_ID: z.string().min(1).optional(),
  QBO_CLIENT_SECRET: z.string().min(1).optional(),
  QBO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  QBO_REDIRECT_URI: z.url().optional(),
  // Base64 32-byte key sealing the OAuth tokens at rest (platform/crypto/secret-box). Optional so
  // the app boots without it, but the connect flow fail-closes when absent: storing a live refresh
  // token in plaintext is not an acceptable degradation. Mint one with `generateKey()`.
  QBO_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
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
