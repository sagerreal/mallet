import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Tenant root. Org-level access control + signup bootstrap handled in the identity module (T2).
export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // The org's provisioned Twilio business number in E.164 (e.g. "+15005550006"). Nullable: orgs
    // without a number provisioned cannot send outbound SMS. Set manually/by config for the pilot;
    // programmatic provisioning via the Twilio Numbers API is a Phase 2 follow-up.
    twilioNumber: text("twilio_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique index: only non-null twilioNumber values must be unique across orgs.
    // Prevents two orgs from sharing a business number, which would misroute inbound SMS.
    uniqueIndex("orgs_twilio_number_uidx").on(t.twilioNumber).where(sql`${t.twilioNumber} is not null`),
  ],
);
