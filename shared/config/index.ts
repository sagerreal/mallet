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
  // Vercel's own stable production domain (system env var, exposed at build AND runtime). Read
  // ONLY as the fallback in resolvePublicAppOrigin — see there for why it is not VERCEL_URL.
  VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),
  // Comms providers — all OPTIONAL. Each channel independently falls back to the logging stub when
  // unconfigured (graceful degradation). Email needs RESEND_API_KEY + EMAIL_FROM; SMS needs all
  // three Twilio vars. ANTHROPIC_API_KEY unblocks the Phase 3 AI features.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(), // e.g. "Mallet <notifications@yourdomain.com>"
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),
  // The ONE Mallet-owned number every shop's staff texts to reach the assistant. Deliberately
  // NOT per-org: a tech texting the assistant is Mallet talking to its own user, not a shop
  // texting a customer, so it rides Mallet's own A2P registration and no shop has to register
  // anything before their crew can use it. A shop's `orgs.twilio_number` stays purely for
  // customer conversations.
  //
  // Optional: unset, the inbound webhook simply never takes the staff branch and every text keeps
  // the existing customer behaviour. That is the correct dark state — the feature is off, not
  // half-on.
  MALLET_ASSISTANT_NUMBER: z.string().min(1).optional(),
  // The Messaging Service carrying Mallet's approved 10DLC campaign, used for assistant replies.
  // Carriers check the SERVICE: a reply sent naming a bare `from` is filtered as unregistered
  // traffic even when the campaign is approved and the number sits in that service's pool.
  MALLET_ASSISTANT_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
  /**
   * THE SHARED LINE a shop's AUTOMATED texts ride until it has a number of its own.
   *
   * A2P vetting runs 5-7 business days and can run weeks; a shop that signs up this morning still
   * has to be able to invoice, remind and receipt. Jobber and Housecall Pro both send automated
   * messages from a platform number until the business has a dedicated one, and this is Mallet's.
   * The moment a shop's own number and Messaging Service exist, its automated texts move there —
   * see resolveOrgNotificationSender.
   *
   * DELIBERATELY NOT `TWILIO_FROM_NUMBER`, whose name says nothing about whose number it is, and
   * which has never been set in any environment (so every automated text has been logged, never
   * sent). Its own pair, so pointing the shared line somewhere else later is a config change.
   *
   * ONE-WAY, and that is not a limitation to fix: a number that serves every shop belongs to none
   * of them, so an inbound reply has no org to land in. The webhook already ignores a text from a
   * number it does not recognise, which is the behaviour Jobber documents for its own pool.
   *
   * Unset, SMS notifications keep degrading to the logging stub exactly as they do today.
   */
  MALLET_SHARED_SMS_NUMBER: z.string().min(1).optional(),
  /**
   * The Messaging Service carrying the campaign for the shared line. Carriers check the SERVICE.
   *
   * OPTIONAL, and usually left unset: it falls back to MALLET_ASSISTANT_MESSAGING_SERVICE_SID,
   * because the shared line and the assistant start out as the same number and so the same
   * service. Setting the number above is the whole switch. Name this one only when the shared line
   * moves to a number in a DIFFERENT service.
   */
  MALLET_SHARED_SMS_MESSAGING_SERVICE_SID: z.string().min(1).optional(),
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
  // Browser calling (Twilio Voice JS SDK). All three needed together: the API key pair SIGNS the
  // short-lived Access Token the browser authenticates with, and the TwiML App is what Twilio
  // fetches when the browser dials. The key MUST be a Standard key — Twilio does not support
  // signing Access Tokens with a Restricted key. Without these the browser softphone self-disables
  // and calling falls back to ringing the user's handset.
  TWILIO_API_KEY_SID: z.string().min(1).optional(),
  TWILIO_API_KEY_SECRET: z.string().min(1).optional(),
  TWILIO_TWIML_APP_SID: z.string().min(1).optional(),
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
  // Square. A shop already running Square will not change processors to change software, so this
  // is a second payment provider beside Stripe, selected per-org (org_settings.payment_provider).
  //
  // All OPTIONAL, matching the QBO and Stripe pattern: with no application id/secret the Square
  // gateways construct as null and the connect flow self-disables, rather than 500-ing an app that
  // every Stripe org is happily using. Absence is a configuration state, not a crash.
  //
  // The environment switch picks the API HOST (connect.squareupsandbox.com vs connect.squareup.com)
  // AND the credential set — sandbox ids are rejected against live sellers and vice versa, so the
  // two can never be mixed by accident.
  SQUARE_APPLICATION_ID: z.string().min(1).optional(),
  SQUARE_APPLICATION_SECRET: z.string().min(1).optional(),
  SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  SQUARE_REDIRECT_URI: z.url().optional(),
  // Verifies Square webhook signatures. Optional so the app boots without it, but the webhook
  // route fail-closes when absent: an unverified payment notification is an instruction from an
  // unauthenticated stranger to mark an invoice paid.
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().min(1).optional(),
  // Base64 32-byte key sealing the OAuth tokens at rest (platform/crypto/secret-box) AND signing
  // the connect flow's state parameter. Optional so the app boots without it, but the connect
  // flow fail-closes when absent: storing a live Square token in plaintext is not an acceptable
  // degradation when that token can charge a real merchant's customers. Mint with generateKey().
  SQUARE_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  // Self-serve signup. Mallet is INVITE-ONLY while in pilot: with this unset (the default),
  // identity.signup refuses to provision a fresh org for anyone without a pending org_invites
  // row — invited staff still join their org. "1" or "true" reopens self-serve org creation.
  // The Supabase dashboard's "allow new users to sign up" toggle is the companion gate at the
  // auth layer; reopening signups means flipping BOTH.
  SIGNUPS_OPEN: z.preprocess((v) => v === "1" || v === "true", z.boolean()),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * The canonical origin to put in front of a link we hand to a CUSTOMER — no trailing slash.
 * Returns null when neither source is available, which callers must treat as a refusal.
 *
 * Resolution order, and the reasoning for it:
 *  1. `PUBLIC_APP_URL` — the operator's explicit choice, so it always wins. This is where a real
 *     custom domain goes.
 *  2. `https://<VERCEL_PROJECT_PRODUCTION_URL>` — Vercel's STABLE production domain for the
 *     project. A safety net so a shop that never set PUBLIC_APP_URL still sends openable links.
 *
 * What is deliberately NOT in that list is `VERCEL_URL`, the per-deployment URL. Vercel's own docs
 * say it "cannot be used in conjunction with Standard Deployment Protection" — a deployment URL
 * sits behind Vercel's login wall, so a link built from it opens fine for the signed-in sender and
 * shows a Vercel sign-in page to the customer. Same reason the browser's `window.location.origin`
 * is not an acceptable source: it is whatever URL the sender happened to be on.
 */
export const resolvePublicAppOrigin = (config: Config): string | null => {
  const explicit = config.PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelDomain = config.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelDomain) return `https://${vercelDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
    throw new Error(`Invalid or missing configuration: ${fields}`);
  }
  return parsed.data;
};
