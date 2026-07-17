import { loadConfig } from "@mallet/shared/config";
import { db } from "@mallet/shared/db/client";
import { createAuthProvider, createApiKeyAuthenticator, createSupabaseTokenVerifier, SignupStore } from "@mallet/identity";
import { StripePaymentLinkGateway } from "@mallet/invoicing";
import { StripeConnectGateway } from "@mallet/settings";
import { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import {
  LoggingNotificationSender,
  ResendEmailSender,
  TwilioSmsSender,
  ChannelRouterNotificationSender,
} from "@mallet/notifications";
import { AnthropicLlmClient } from "@mallet/ai";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { systemClock } from "@mallet/shared/types";
import type { AppDeps } from "./deps";
import type { PaymentLinkGateway } from "@mallet/invoicing";
import type { ConnectGateway } from "@mallet/settings";
import { SupabasePhotoStorageGateway } from "@mallet/jobs";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PhotoStorageGateway } from "@mallet/jobs";
import type { NotificationSender, NotificationChannel } from "@mallet/notifications";
import type { LlmClient } from "@mallet/ai";

// Composition root for runtime dependencies. Built once and reused across requests (the auth
// provider and DB pool are long-lived). The in-memory event bus is a placeholder until the
// durable outbox lands.
let cached: AppDeps | null = null;

export const getAppDeps = (): AppDeps => {
  if (cached) return cached;
  const config = loadConfig();
  // One StripeClient (one process-wide circuit breaker) shared by the payment + connect gateways.
  // Both self-disable unless the secret key and the public URL (for hosted redirects) are set.
  const stripe = config.STRIPE_SECRET_KEY ? new StripeClient(config.STRIPE_SECRET_KEY) : null;
  let paymentLinkGateway: PaymentLinkGateway | null = null;
  let connectGateway: ConnectGateway | null = null;
  if (stripe && config.PUBLIC_APP_URL) {
    paymentLinkGateway = new StripePaymentLinkGateway(stripe, config.PUBLIC_APP_URL);
    connectGateway = new StripeConnectGateway(stripe, uuidGenerator);
  }

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

  // Photo storage self-disables unless the service-role Supabase env is present (getSupabaseAdmin
  // throws otherwise). Bind lazily — the client is built on first upload, not at boot.
  let photoStorageGateway: PhotoStorageGateway | null = null;
  if (config.SUPABASE_SERVICE_ROLE_KEY && config.NEXT_PUBLIC_SUPABASE_URL) {
    photoStorageGateway = new SupabasePhotoStorageGateway(() => getSupabaseAdmin() as never);
  }

  cached = {
    authProvider: createAuthProvider({
      supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      db,
    }),
    apiKeyAuthenticator: createApiKeyAuthenticator(db),
    tokenVerifier: createSupabaseTokenVerifier(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    signupStore: new SignupStore(db),
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway,
    connectGateway,
    photoStorageGateway,
    notificationSender,
    llmClient,
  };
  return cached;
};
