import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { leads } from "./leads";
import { users } from "./users";

/**
 * The customer activity trail: typed notes, logged calls, sent texts.
 *
 * Until this existed the whole trail lived in the Zustand store's `lead.acts` array and nowhere
 * else. The store has no persist middleware and the leads hydrator resets `acts: []` on every
 * refetch, so a gate code typed into the Notes composer — and every call outcome and every sent
 * text logged beside it — survived until the next refetch and then vanished.
 *
 * `kind` mirrors the store's LeadNote.type so the existing note feed renders these unchanged.
 * `body` is the text; the call-shaped columns are nullable because only a call fills them.
 */
export const leadNotes = pgTable(
  "lead_notes",
  {
    // Client-authored: the store hands out a note id synchronously (the home queue's 30s Undo
    // deletes exactly the note a Send appended), so the row must carry the same id.
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull(),
    // "note" | "call" | "text" | "system" | "visit" | "ai" — kept as text rather than an enum so
    // a new activity kind does not need a migration to start being recorded.
    kind: text("kind").notNull(),
    body: text("body").notNull().default(""),
    /** Who/what produced it: "us" | "them" | "auto" for a text, the staffer otherwise. */
    author: text("author"),
    /** Call-only: direction, disposition, duration, channel. */
    direction: text("direction"),
    outcome: text("outcome"),
    durationLabel: text("duration_label"),
    via: text("via"),
    /** Front Desk overnight shift — feeds the home Handoff note. */
    overnight: boolean("overnight").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // Composite FK (org_id, lead_id) → leads(org_id, id): a note can never point at another
    // tenant's customer. Targets the composite unique "leads_org_id_uq".
    foreignKey({
      name: "lead_notes_org_lead_fk",
      columns: [t.orgId, t.leadId],
      foreignColumns: [leads.orgId, leads.id],
    }),
    // The only read: one lead's trail, newest last. org_id leads so the index serves the
    // RLS-filtered scan rather than sitting behind it.
    index("lead_notes_org_lead_created_idx").on(t.orgId, t.leadId, t.createdAt),
  ],
);
