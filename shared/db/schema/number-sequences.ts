import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Per-org gapless counters for human document numbers (EST-1000, INV-…, JOB-…). One row per
// (org, kind); allocation locks the row with SELECT ... FOR UPDATE inside the caller's tx.
export const numberSequences = pgTable(
  "number_sequences",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    nextVal: integer("next_val").notNull().default(1000),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.kind] }),
    // 'po' rides the same allocator as invoices — see DrizzlePurchaseOrderRepository.nextNumber.
    check("number_sequences_kind_check", sql`${t.kind} in ('estimate', 'invoice', 'job', 'po')`),
  ],
);
