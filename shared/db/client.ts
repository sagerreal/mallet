import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "@mallet/shared/config";
import * as schema from "./schema";

// Runtime database client. Connects as the least-privilege `mallet_app` role
// (NOBYPASSRLS) so Row-Level Security is always in force — a query that forgets
// to scope by tenant returns zero rows rather than leaking across orgs.
//
// Migrations connect separately as the table owner (see drizzle.config.ts); this
// client is never used to run DDL.
//
// Server-only. Importing this from a client component leaks the connection string.
const config = loadConfig();

// `prepare: false` is required behind Supabase's transaction/session pooler (Supavisor),
// which does not support the extended-query prepared-statement protocol across pooled conns.
//
// Cache the pool on globalThis in development: Next.js Fast Refresh re-evaluates this module on
// every hot reload, and a fresh postgres() each time would leak the old pool's connections until
// Supabase's pooler limit (EMAXCONNSESSION) is hit. In production the module loads once per process,
// so the cache is a no-op there.
const globalForDb = globalThis as unknown as { _malletQueryClient?: ReturnType<typeof postgres> };

const queryClient =
  globalForDb._malletQueryClient ??
  postgres(config.APP_DATABASE_URL, {
    ssl: "require",
    prepare: false,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb._malletQueryClient = queryClient;

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
export { schema };

// Close the connection pool — for graceful shutdown and to let test runners exit cleanly.
export const closeDb = (): Promise<void> => queryClient.end({ timeout: 5 });
