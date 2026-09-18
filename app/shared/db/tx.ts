import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { OrgId } from "@mallet/shared/types";
import { db, schema } from "./client";
import { withConnectionRetry } from "./connection-retry";

// A transaction bound to a single tenant. All queries run with the RLS GUC set,
// so policies (org_id = current_org_id()) scope reads and writes to this org.
export type TenantTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// Run `fn` inside a transaction scoped to `orgId`. Sets the transaction-local GUC
// `app.current_org_id` (read by the current_org_id() SQL function in RLS policies)
// before any of the caller's queries execute. The value is parameterized, so the
// org id cannot be used for SQL injection.
//
// This is the ONLY sanctioned way to touch tenant-scoped tables at runtime. Queries
// outside a withTenant block run with no org set and RLS returns nothing — fail-closed.
export const withTenant = <T>(orgId: OrgId, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
  // Retry only cold-connection transients (pre-statement, so safe); a failed/rolled-back tx
  // leaves nothing persisted, and external side effects belong outside the tx (outbox), not here.
  withConnectionRetry(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      return fn(tx);
    }),
  );
