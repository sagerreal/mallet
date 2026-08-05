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
    /**
     * The shop's default sales-tax rate in basis points (825 = 8.25%).
     *
     * ONE rate per shop, seeded onto each new quote and overridable on that quote — Jobber's
     * global-with-override model, and the reason 830 of 832 live invoices carry 0%: the only place
     * tax could be authored was a per-quote number input that started empty every time.
     *
     * Defaults to 0 because a wrong rate is worse than none: it would put a number on a customer's
     * bill that the shop never agreed to and owes to nobody. A shop sets it once in Settings.
     */
    taxBps: integer("tax_bps").notNull().default(0),
    visitScopeMinutes: integer("visit_scope_minutes").notNull().default(30),
    visitRepairMinutes: integer("visit_repair_minutes").notNull().default(90),
    visitInstallMinutes: integer("visit_install_minutes").notNull().default(240),
    techSeesPrice: boolean("tech_sees_price").notNull().default(true),
    techTexts: boolean("tech_texts").notNull().default(true),
    // Defaults OFF. It used to default true, which handed every new shop a phone number pointed at
    // an assistant that knew nobody's hours, no service area and no services. It switches on when
    // frontDeskReadiness says it can — see modules/settings/domain/front-desk-readiness.ts.
    frontDesk: boolean("front_desk").notNull().default(false),
    scopeOn: boolean("scope_on").notNull().default(false),
    // Money's "Auto-remind" switch. It was useState(true) in the header — a control that promised
    // reminder texts on a schedule and was wired to nothing at all.
    autoRemind: boolean("auto_remind").notNull().default(true),
    // Org-level gate for the Measurements section (job modal room captures + pricing-from-measurements).
    // Only measurement-priced trades (painting etc.) opt in — plumbing and similar trades never see the
    // section at all when this is false. Defaults off so existing orgs are unaffected.
    measurementEstimating: boolean("measurement_estimating").notNull().default(false),
    // Kept for one release so a rollback still reads real hours; NOTHING reads these any more.
    // Per-day columns below replaced them — "weekdays" could not express a shop that closes early
    // on Friday, which is most of them.
    hoursWdOpen: integer("hours_wd_open").notNull().default(8),
    hoursWdClose: integer("hours_wd_close").notNull().default(17),
    // Per-day hours. Backfilled from the weekday pair above, so every existing org keeps exactly
    // the hours it had. 0/0 is the closed sentinel, same convention as Saturday/Sunday.
    hoursMonOpen: integer("hours_mon_open").notNull().default(8),
    hoursMonClose: integer("hours_mon_close").notNull().default(17),
    hoursTueOpen: integer("hours_tue_open").notNull().default(8),
    hoursTueClose: integer("hours_tue_close").notNull().default(17),
    hoursWedOpen: integer("hours_wed_open").notNull().default(8),
    hoursWedClose: integer("hours_wed_close").notNull().default(17),
    hoursThuOpen: integer("hours_thu_open").notNull().default(8),
    hoursThuClose: integer("hours_thu_close").notNull().default(17),
    hoursFriOpen: integer("hours_fri_open").notNull().default(8),
    hoursFriClose: integer("hours_fri_close").notNull().default(17),
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
    // ── Business identity (printed on customer documents) ────────────────────
    // What a customer needs to see to know WHO billed them, act on it, and keep it.
    // Deliberately separate from the fields that look like them:
    //   • bizAddress is NOT serviceOriginAddress — that one is a routing origin (often a yard)
    //     and editing an invoice must never move where drive time is measured from.
    //   • bizPhone is NOT orgs.twilioNumber — a shop with no provisioned line still has a phone,
    //     and the number on a document should not change when telephony is reconfigured.
    // Business NAME is orgs.name and website is brandSite; neither is duplicated here.
    // All nullable: the lazily-created default org_settings row must stay valid without them,
    // and every consumer omits the row it has no value for rather than printing a blank label.
    bizAddress: text("biz_address"),
    bizPhone: text("biz_phone"),
    bizEmail: text("biz_email"),
    // Contractor/trade licence as the shop writes it. Texas 22 TAC 367.10 requires it on a
    // plumbing invoice; California B&P 7030.5 covers contracts and advertising but NOT invoices.
    // Treated as commercial convention, never as a legal guarantee — free text, no validation.
    licenseNumber: text("license_number"),
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
