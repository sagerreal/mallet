import { loadConfig } from "@mallet/shared/config";
import { db } from "@mallet/shared/db/client";
import { createAuthProvider } from "@mallet/identity";
import { StripePaymentLinkGateway } from "@mallet/invoicing";
import { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import {
  LoggingNotificationSender,
  ResendEmailSender,
  TwilioSmsSender,
  ChannelRouterNotificationSender,
} from "@mallet/notifications";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { systemClock } from "@mallet/shared/types";
import type { AppDeps } from "./deps";
import type { PaymentLinkGateway } from "@mallet/invoicing";
import type { NotificationSender, NotificationChannel } from "@mallet/notifications";

// Composition root for runtime dependencies. Built once and reused across requests (the auth
// provider and DB pool are long-lived). The in-memory event bus is a placeholder until the
// durable outbox lands.
let cached: AppDeps | null = null;

export const getAppDeps = (): AppDeps => {
  if (cached) return cached;
  const config = loadConfig();
  // Card payments self-disable unless both the secret key and the public URL (for hosted-checkout
  // redirects) are set.
  let paymentLinkGateway: PaymentLinkGateway | null = null;
  if (config.STRIPE_SECRET_KEY && config.PUBLIC_APP_URL) {
    paymentLinkGateway = new StripePaymentLinkGateway(
      new StripeClient(config.STRIPE_SECRET_KEY),
      config.PUBLIC_APP_URL,
    );
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

  cached = {
    authProvider: createAuthProvider({
      supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      db,
    }),
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway,
    notificationSender,
  };
  return cached;
};
