import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { db } from "@mallet/shared/db/client";
import { createAuthProvider, createApiKeyAuthenticator, createSupabaseTokenVerifier, SignupStore } from "@mallet/identity";
import { StripePaymentLinkGateway, StripeTerminalGateway, StripeCardChargeGateway } from "@mallet/invoicing";
import { StripeConnectGateway } from "@mallet/settings";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import {
  LoggingNotificationSender,
  ResendEmailSender,
  TwilioSmsSender,
  ChannelRouterNotificationSender,
} from "@mallet/notifications";
import { AnthropicLlmClient } from "@mallet/ai";
import { TwilioA2pGateway, TwilioNumberProvisioner, VapiVoiceRegistrar } from "@mallet/a2p";
import type { NumberProvisioner, VoiceRegistrar } from "@mallet/a2p";
import type { A2pGateway } from "@mallet/a2p";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { HttpQboOauthGateway } from "@mallet/accounting-sync";
import { createSecretBox } from "@mallet/platform/crypto/secret-box";
import {
  TwilioCallOriginator,
  TwilioVoiceTokenIssuer,
  type CallOriginator,
  type VoiceTokenIssuer,
} from "@mallet/calls";
import { systemClock } from "@mallet/shared/types";
import type { AppDeps } from "./deps";
import type { Config } from "@mallet/shared/config";
import type { PaymentLinkGateway, TerminalGateway, CardChargeGateway } from "@mallet/invoicing";
import type { ConnectGateway } from "@mallet/settings";
import { SupabasePhotoStorageGateway } from "@mallet/jobs";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { SupabaseChatFileGateway } from "@mallet/team-chat";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { NotificationSender, NotificationChannel } from "@mallet/notifications";
import type { LlmClient } from "@mallet/ai";

// A2P 10DLC registration self-disables (→ LoggingA2pGateway fallback, applied at the point of use
// in a2p-router.ts) unless the full Twilio A2P config is present. Extracted from getAppDeps to keep
// its complexity down.
// Number buying needs only the Twilio credentials and a public URL for the SMS webhook — NOT the
// A2P profile config, because a number works for voice the day it is bought while texting waits on
// carrier vetting. Gating them together would leave a new shop unable to take calls.
function buildNumberProvisioner(config: Config): NumberProvisioner | undefined {
  const origin = resolvePublicAppOrigin(config);
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && origin) {
    return new TwilioNumberProvisioner(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      `${origin}/api/webhooks/twilio`,
    );
  }
  logger.warn("a2p: number provisioning unconfigured (TWILIO_ACCOUNT_SID/AUTH_TOKEN or public URL missing) — new orgs get no phone number");
  return undefined;
}

// Connecting a bought number to the AI front desk. Self-disables without a Vapi key, in which
// case the number is still bought and still texts — it just answers with Twilio's default
// recording until somebody wires it, which is logged loudly at provision time.
function buildVoiceRegistrar(config: Config): VoiceRegistrar | undefined {
  const origin = resolvePublicAppOrigin(config);
  if (config.VAPI_API_KEY && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && origin) {
    return new VapiVoiceRegistrar(
      config.VAPI_API_KEY,
      `${origin}/api/frontdesk/vapi`,
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      config.VAPI_WEBHOOK_SECRET,
    );
  }
  logger.warn("a2p: voice registrar unconfigured (VAPI_API_KEY/TWILIO creds/public URL missing) — new numbers will not answer calls");
  return undefined;
}

function buildA2pGateway(config: Config): A2pGateway | undefined {
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_PRIMARY_PROFILE_SID && config.TWILIO_A2P_STATUS_CALLBACK_URL) {
    return new TwilioA2pGateway(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      config.TWILIO_PRIMARY_PROFILE_SID,
      config.TWILIO_A2P_STATUS_CALLBACK_URL,
    );
  }
  logger.warn("a2p: Twilio A2P config unconfigured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PRIMARY_PROFILE_SID/A2P_STATUS_CALLBACK_URL missing) — registration is logged, not submitted");
  return undefined;
}

// Outbound click-to-call self-disables (→ null, surfaced as PRECONDITION_FAILED by calls.place)
// unless the Twilio account creds AND the public URL are present. The public URL is required
// because Twilio must be able to FETCH the TwiML and POST status back — a call placed with an
// unreachable callback URL connects to silence.
function buildCallOriginator(config: Config): CallOriginator | null {
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.PUBLIC_APP_URL) {
    const base = config.PUBLIC_APP_URL.replace(/\/+$/, "");
    return new TwilioCallOriginator(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      `${base}/api/voice/outbound`,
      `${base}/api/webhooks/twilio/voice-status`,
    );
  }
  logger.warn("calls: Twilio voice unconfigured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PUBLIC_APP_URL missing) — outbound calling is disabled");
  return null;
}

// The browser softphone's token issuer. Self-disables (→ null) unless the Standard API key pair
// and the TwiML app are all present; calling then falls back to the phone bridge, which is a
// complete feature on its own — so unlike the originator, this degrading is not a failure.
function buildVoiceTokenIssuer(config: Config): VoiceTokenIssuer | null {
  if (
    config.TWILIO_ACCOUNT_SID &&
    config.TWILIO_API_KEY_SID &&
    config.TWILIO_API_KEY_SECRET &&
    config.TWILIO_TWIML_APP_SID
  ) {
    return new TwilioVoiceTokenIssuer(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_API_KEY_SID,
      config.TWILIO_API_KEY_SECRET,
      config.TWILIO_TWIML_APP_SID,
    );
  }
  logger.info("calls: browser calling unconfigured (TWILIO_API_KEY_SID/SECRET/TWIML_APP_SID) — falling back to the phone bridge");
  return null;
}

// QuickBooks Online. Two independently-optional pieces, and they fail differently ON PURPOSE:
// the gateway degrading to null just disables the feature, but a missing/!32-byte encryption key
// must NOT degrade to plaintext token storage — so the box is null and the connect flow refuses.
const buildQboSecretBox = (keyBase64: string | undefined) => {
  if (!keyBase64) {
    logger.warn("qbo: QBO_TOKEN_ENCRYPTION_KEY unset — connecting QuickBooks is disabled (tokens would be unprotected)");
    return null;
  }
  const box = createSecretBox(keyBase64);
  if (!box.ok) {
    logger.error("qbo: QBO_TOKEN_ENCRYPTION_KEY is not a 32-byte base64 key — connecting QuickBooks is disabled");
    return null;
  }
  return box.value;
};

// Composition root for runtime dependencies. Built once and reused across requests (the auth
// provider and DB pool are long-lived). The in-memory event bus is a placeholder until the
// durable outbox lands.
let cached: AppDeps | null = null;

export const getAppDeps = (): AppDeps => {
  if (cached) return cached;
  const config = loadConfig();
  // ONE StripeClient (one process-wide circuit breaker) shared by the payment + connect gateways
  // AND the plain routes (webhook, reconcile, public checkout) via getSharedStripeClient — the
  // breaker only means something if every Stripe call in the process counts toward it.
  // Both gateways self-disable unless the secret key and the public URL (for hosted redirects) are set.
  const stripe = config.STRIPE_SECRET_KEY ? getSharedStripeClient(config.STRIPE_SECRET_KEY) : null;
  let paymentLinkGateway: PaymentLinkGateway | null = null;
  let connectGateway: ConnectGateway | null = null;
  if (stripe && config.PUBLIC_APP_URL) {
    paymentLinkGateway = new StripePaymentLinkGateway(stripe, config.PUBLIC_APP_URL);
    connectGateway = new StripeConnectGateway(stripe);
  }
  // Terminal needs only the Stripe key (no hosted-redirect URL — the "reader" is the phone in the
  // same room), so it is gated on the key alone rather than riding paymentLinkGateway's gate.
  const terminalGateway: TerminalGateway | null = stripe ? new StripeTerminalGateway(stripe) : null;
  // No PUBLIC_APP_URL requirement: charging a saved card involves no hosted redirect.
  const cardChargeGateway: CardChargeGateway | null = stripe ? new StripeCardChargeGateway(stripe) : null;

  // Per-channel comms senders; each self-disables (→ logging fallback) unless fully configured.
  const byChannel: Partial<Record<NotificationChannel, NotificationSender>> = {};
  if (config.RESEND_API_KEY && config.EMAIL_FROM) {
    byChannel.email = new ResendEmailSender(config.RESEND_API_KEY, config.EMAIL_FROM, systemClock);
  }
  if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER) {
    byChannel.sms = new TwilioSmsSender(
      config.TWILIO_ACCOUNT_SID,
      config.TWILIO_AUTH_TOKEN,
      config.TWILIO_FROM_NUMBER,
      systemClock,
      undefined,
      config.PUBLIC_APP_URL,
    );
  }
  // Warn once at boot for any channel that fell back to the logging stub — so a partial-config
  // deploy (e.g. email live, sms not) is visible in ops rather than silently logging "sent".
  if (!byChannel.email) {
    logger.warn("comms: email channel unconfigured (RESEND_API_KEY/EMAIL_FROM missing) — email notifications are logged, not sent");
  }
  if (!byChannel.sms) {
    logger.warn("comms: sms channel unconfigured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER missing) — sms notifications are logged, not sent");
  }
  const notificationSender = new ChannelRouterNotificationSender(
    new LoggingNotificationSender(systemClock),
    byChannel,
  );

  // The agent's model client self-disables unless the Anthropic key is set.
  const llmClient: LlmClient | null = config.ANTHROPIC_API_KEY ? new AnthropicLlmClient(config.ANTHROPIC_API_KEY) : null;

  const a2pGateway = buildA2pGateway(config);
  const numberProvisioner = buildNumberProvisioner(config);
  const voiceRegistrar = buildVoiceRegistrar(config);
  const callOriginator = buildCallOriginator(config);
  const voiceTokenIssuer = buildVoiceTokenIssuer(config);

  // QBO OAuth self-disables unless client id + secret + redirect uri are all present.
  const qboOauthGateway =
    config.QBO_CLIENT_ID && config.QBO_CLIENT_SECRET && config.QBO_REDIRECT_URI
      ? new HttpQboOauthGateway({
          clientId: config.QBO_CLIENT_ID,
          clientSecret: config.QBO_CLIENT_SECRET,
          redirectUri: config.QBO_REDIRECT_URI,
        })
      : null;
  if (!qboOauthGateway) {
    logger.warn("qbo: QuickBooks unconfigured (QBO_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI missing) — the Settings card shows 'not configured'");
  }
  const qboSecretBox = buildQboSecretBox(config.QBO_TOKEN_ENCRYPTION_KEY);

  // Photo storage self-disables unless the service-role Supabase env is present (getSupabaseAdmin
  // throws otherwise). Bind lazily — the client is built on first upload, not at boot.
  let photoStorageGateway: PhotoStorageGateway | null = null;
  if (config.SUPABASE_SERVICE_ROLE_KEY && config.NEXT_PUBLIC_SUPABASE_URL) {
    photoStorageGateway = new SupabasePhotoStorageGateway(() => getSupabaseAdmin() as never);
  }

  const signupStore = new SignupStore(db);

  cached = {
    authProvider: createAuthProvider({
      supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      db,
    }),
    apiKeyAuthenticator: createApiKeyAuthenticator(db),
    tokenVerifier: createSupabaseTokenVerifier(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    signupStore: signupStore,
    // Same self-disable posture as photoStorageGateway: bound lazily, null without Storage env.
    chatFileGateway: photoStorageGateway
      ? new SupabaseChatFileGateway(() => getSupabaseAdmin() as never)
      : null,
    signupsOpen: config.SIGNUPS_OPEN,
    inviteGate: signupStore,
    bus: new InMemoryEventBus(),
    qboOauthGateway,
    qboSecretBox,
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway,
    terminalGateway,
    cardChargeGateway,
    connectGateway,
    photoStorageGateway,
    notificationSender,
    llmClient,
    a2pGateway,
    numberProvisioner,
    voiceRegistrar,
    callOriginator,
    voiceTokenIssuer,
  };
  return cached;
};
