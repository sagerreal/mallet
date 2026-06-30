import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Tenant root. Org-level access control + signup bootstrap handled in the identity module (T2).
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
