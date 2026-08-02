import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";

/**
 * Estimating assemblies — a sellable scope ("Driveway replacement, 3-inch")
 * whose price resolves measured geometry through a component recipe (materials,
 * labor, trucking, fixed fees) instead of a flat sqft rate. Identity, basis,
 * pricing mode and money knobs live in columns; the recipe (components +
 * unit-rate brackets) is a VERSIONED jsonb config blob validated at every
 * boundary by modules/assemblies/domain/assembly-config.ts.
 *
 * The shipped catalog (assembly-defaults.ts) is never seeded — an org has rows
 * only for defaults it EDITED (catalog_key set, copy-on-write) or scopes it
 * authored (catalog_key null). A soft-deleted catalog_key row is a tombstone:
 * "this org removed that default from its book."
 *
 * measurement_basis admits 'line'/'count' now (roofing's bases, a later PR)
 * so their arrival is code-only — no ALTER, no migration churn.
 *
 * RLS: hand-written in 0130 (ENABLE + FORCE, org_id = current_org_id()),
 * mirroring 0123_site_captures_rls.sql.
 */
export const assemblies = pgTable(
  "assemblies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Which shipped default this row overrides; null = org-authored custom.
    catalogKey: text("catalog_key"),
    name: text("name").notNull(),
    measurementBasis: text("measurement_basis").notNull(),
    pricingMode: text("pricing_mode").notNull(),
    marginBps: integer("margin_bps").notNull().default(0),
    jobMinimumCents: integer("job_minimum_cents").notNull().default(0),
    // { version, components[], tiers[] } — see assembly-config.ts.
    config: jsonb("config").notNull(),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target for future child tables' (org_id, id) FKs — the
    // same additive-safety move pricebook_items made.
    unique("assemblies_org_id_uq").on(t.orgId, t.id),
    // One override row per catalog default per org (tombstones included —
    // restoring a removed default undeletes the row rather than duplicating it).
    // Postgres treats NULLs as distinct, so custom assemblies are unaffected.
    unique("assemblies_org_catalog_key_uq").on(t.orgId, t.catalogKey),
    index("assemblies_org_deleted_idx").on(t.orgId, t.deletedAt),
    check(
      "assemblies_measurement_basis_check",
      sql`${t.measurementBasis} in ('area', 'perimeter', 'line', 'count')`,
    ),
    check("assemblies_pricing_mode_check", sql`${t.pricingMode} in ('cost_plus', 'unit_rate')`),
    check(
      "assemblies_margin_bps_check",
      sql`${t.marginBps} >= 0 and ${t.marginBps} <= 40000`,
    ),
    check("assemblies_job_minimum_check", sql`${t.jobMinimumCents} >= 0`),
  ],
);
