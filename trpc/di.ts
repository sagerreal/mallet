import { loadConfig } from "@mallet/shared/config";
import { db } from "@mallet/shared/db/client";
import { createAuthProvider } from "@mallet/identity";
import { StripePaymentLinkGateway } from "@mallet/invoicing";
import { StripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { systemClock } from "@mallet/shared/types";
import type { AppDeps } from "./deps";
import type { PaymentLinkGateway } from "@mallet/invoicing";

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
  };
  return cached;
};
