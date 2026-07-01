import { loadConfig } from "@mallet/shared/config";
import { db } from "@mallet/shared/db/client";
import { createAuthProvider } from "@mallet/identity";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { systemClock } from "@mallet/shared/types";
import type { AppDeps } from "./deps";

// Composition root for runtime dependencies. Built once and reused across requests (the auth
// provider and DB pool are long-lived). The in-memory event bus is a placeholder until the
// durable outbox lands.
let cached: AppDeps | null = null;

export const getAppDeps = (): AppDeps => {
  if (cached) return cached;
  const config = loadConfig();
  cached = {
    authProvider: createAuthProvider({
      supabaseUrl: config.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      db,
    }),
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
  };
  return cached;
};
