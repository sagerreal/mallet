import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

/**
 * One page of a presentation template (jsonb column shape). Ordered array; `on` is the
 * template's default activation — the composer copies it per quote and the customer page
 * hides any non-cover page whose body is empty, so a fresh template (all pages on, bodies
 * empty) renders as just the estimate until the shop writes something. No media in v1.
 */
type PresentationPageColumn = {
  key: "cover" | "about" | "reviews" | "thanks";
  on: boolean;
  title: string;
  body: string;
};

/**
 * A reusable presentation — the designed pages (cover, about us, reviews, thank-you) that wrap
 * a quote into a proposal, PaintScout-style. Org-level and shared across quotes: content lives
 * HERE; which pages a given quote activates lives on that quote's snapshot. Sent quotes freeze
 * a copy into estimates.presentation_snapshot, so editing a template never rewrites them.
 * Soft-delete; same collection grammar as job_terms.
 */
export const presentationTemplates = pgTable(
  "presentation_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pages: jsonb("pages").$type<PresentationPageColumn[]>().notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("presentation_templates_org_deleted_idx").on(t.orgId, t.deletedAt)],
);
