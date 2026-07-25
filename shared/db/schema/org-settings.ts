import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  unique,
} from "drizzle-orm/pg-core";
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
    // IANA zone (e.g. "America/Los_Angeles"). REQUIRED to turn a job's timestamp into a timesheet
    // row: a tech finishing at 21:00 Pacific must land on today's sheet, not tomorrow's, and the
    // server runs in UTC. Defaults to Pacific because the beachhead is West-coast trades; every
    // shop should set its own during onboarding.
    timezone: text("timezone").notNull().default("America/Los_Angeles"),
    areaCities: text("area_cities").notNull().default(""),
    areaRadiusMi: integer("area_radius_mi").notNull().default(25),
    // ── Service origin (front-desk vertical coverage) ─────────────────────────
    // The single address proximity/drive-distance is measured FROM. Geocoded on save
    // (US Census, best-effort) to originLat/originLng. All three nullable so the lazily-
    // created default org_settings row is valid without an origin; a geocode miss leaves
    // lat/lng null (the address is still stored) and never blocks the save.
    serviceOriginAddress: text("service_origin_address"),
    originLat: doublePrecision("origin_lat"),
    originLng: doublePrecision("origin_lng"),
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
    // ── Stripe Connect (Express) — PR1 onboarding foundation ──────────────────
    // The connected account id (acct_...) is null until onboarding begins. Status booleans mirror
    // the Stripe Account object and default false; onboardedAt stamps the first time charges go live.
    // No money moves in PR1; destination-charge routing + platform fee land in PR2.
    stripeConnectedAccountId: text("stripe_connected_account_id"),
    stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
    stripePayoutsEnabled: boolean("stripe_payouts_enabled").notNull().default(false),
    stripeDetailsSubmitted: boolean("stripe_details_submitted").notNull().default(false),
    stripeOnboardedAt: timestamp("stripe_onboarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("org_settings_org_id_uq").on(t.orgId),
    unique("org_settings_org_id_row_uq").on(t.orgId, t.id),
  ],
);
