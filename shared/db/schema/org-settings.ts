import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// One row per org. Scalars are typed columns (money in cents, rates in bps, durations in integer
// minutes); the AI Front Desk booking playbook is a nested blob → jsonb. RLS isolates by org_id
// (hand-written migration). The composite unique(org_id, id) supports future child FKs; unique(org_id)
// enforces the one-row-per-org invariant and is the lazy-create upsert conflict target.
export const orgSettings = pgTable(
  "org_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    trade: text("trade").notNull().default("plumbing"),
    markupBps: integer("markup_bps").notNull().default(3500),
    visitScopeMinutes: integer("visit_scope_minutes").notNull().default(30),
    visitRepairMinutes: integer("visit_repair_minutes").notNull().default(90),
    visitInstallMinutes: integer("visit_install_minutes").notNull().default(240),
    techSeesPrice: boolean("tech_sees_price").notNull().default(true),
    techTexts: boolean("tech_texts").notNull().default(true),
    frontDesk: boolean("front_desk").notNull().default(true),
    scopeOn: boolean("scope_on").notNull().default(false),
    hoursWdOpen: integer("hours_wd_open").notNull().default(8),
    hoursWdClose: integer("hours_wd_close").notNull().default(17),
    hoursSatOpen: integer("hours_sat_open").notNull().default(0),
    hoursSatClose: integer("hours_sat_close").notNull().default(0),
    hoursSunOpen: integer("hours_sun_open").notNull().default(0),
    hoursSunClose: integer("hours_sun_close").notNull().default(0),
    areaCities: text("area_cities").notNull().default(""),
    areaRadiusMi: integer("area_radius_mi").notNull().default(25),
    // { services: {name,lane,price?,triggers}[], notServices: string, serviceFee: number,
    //   feeCredited: boolean } — the booking playbook. serviceFee is DOLLARS here (matches the
    //   prototype control), unlike money columns; documented so no one reads it as cents.
    booking: jsonb("booking").notNull(),
    // ── Brand identity (Phase 3) ─────────────────────────────────────────────
    // Brand NAME is orgs.name (not duplicated here). These are the rest of the
    // brand shown on customer quotes/invoices + the pipeline header. All nullable
    // so the lazily-created default org_settings row is valid without brand values.
    brandTagline: text("brand_tagline"),
    brandSite: text("brand_site"),
    brandColor: text("brand_color"),
    brandLogoUrl: text("brand_logo_url"),
    brandInitials: text("brand_initials"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("org_settings_org_id_uq").on(t.orgId),
    unique("org_settings_org_id_row_uq").on(t.orgId, t.id),
  ],
);
