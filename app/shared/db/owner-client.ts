import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "@mallet/shared/config";
import * as schema from "./schema";

// Owner (BYPASSRLS) database client over DATABASE_URL — the `postgres` role that also runs
// migrations. This is the SINGLE sanctioned non-RLS runtime data path (ADR 0003): it exists ONLY
// for the outbox relay, a trusted system process that must read unpublished rows across all tenants.
// The relay touches ONLY the outbox table (claim + mark) with it and NEVER tenant tables — all
// tenant work re-enters withTenant() on the least-privilege mallet_app client so RLS still scopes it.
//
// Server-only. Importing this from a client component leaks an admin connection string.
const config = loadConfig();

// Small pool — the relay is a single low-frequency poller, not a request-path client.
const ownerQueryClient = postgres(config.DATABASE_URL, { ssl: "require", prepare: false, max: 2 });

export const ownerDb = drizzle(ownerQueryClient, { schema });

export const closeOwnerDb = (): Promise<void> => ownerQueryClient.end({ timeout: 5 });
