import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  numeric,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { jobs } from "./jobs";

// Phase-1 measurement capture. A room_capture is one scan (RoomPlan) or manual entry for a
// room on a job; re-scans chain via supersededById (null = current). Composite FK
// (org_id, job_id) -> jobs(org_id, id) keeps a capture from ever pointing at another
// tenant's job. RLS isolates by org_id (hand-written migration, same model as job-execution).
export const roomCaptures = pgTable(
  "room_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull(),
    roomName: text("room_name").notNull(),
    source: text("source").notNull(), // 'roomplan_v1' | 'manual'
    rawPayload: jsonb("raw_payload"), // verbatim; null for manual
    geometry: jsonb("geometry"), // NormalizedGeometry snake_case; null for manual
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    supersededById: uuid("superseded_by_id"), // re-scan chain; null = current
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so painting_room_quantities can FK on (org_id, capture_id)
    // and never link across tenants — same pattern as jobs_org_id_uq.
    unique("room_captures_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "room_captures_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("room_captures_org_job_idx").on(t.orgId, t.jobId, t.deletedAt),
    check("room_captures_source_ck", sql`${t.source} in ('roomplan_v1','manual')`),
  ],
);

// Outdoor site capture: one surface (driveway, patio, walkway, roof facet) traced on satellite
// imagery ('aerial_trace_v1') or typed by hand ('manual'). area_sqft is the WORKING number the
// estimator prices from: for flat surfaces it equals the traced footprint, for pitched surfaces
// it is footprint / cos(atan(pitch_rise/12)) — derived server-side, never trusted from the
// client. Same tenant model as room_captures: composite FK to jobs + hand-written RLS.
export const siteCaptures = pgTable(
  "site_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull(),
    name: text("name").notNull(), // "Driveway", "Front walkway", "Main roof — south face"
    source: text("source").notNull(), // 'aerial_trace_v1' | 'manual'
    surface: text("surface").notNull(), // 'flat' | 'pitched'
    pitchRise: integer("pitch_rise"), // rise-per-12 for pitched surfaces (4 = 4/12); null for flat
    polygon: jsonb("polygon"), // {vertices: [{lat,lng},...], view: {centerLat,centerLng,zoom}}; null for manual
    footprintSqft: numeric("footprint_sqft", { precision: 12, scale: 2, mode: "number" }), // plan area as traced; null for manual
    areaSqft: numeric("area_sqft", { precision: 12, scale: 2, mode: "number" }).notNull(), // working number (pitch-corrected)
    perimeterLnft: numeric("perimeter_lnft", { precision: 12, scale: 2, mode: "number" }), // traced edge length; null for manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so future child tables can FK on (org_id, capture_id) and never
    // link across tenants — same pattern as room_captures_org_id_uq.
    unique("site_captures_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "site_captures_job_fk",
      columns: [t.orgId, t.jobId],
      foreignColumns: [jobs.orgId, jobs.id],
    }).onDelete("cascade"),
    index("site_captures_org_job_idx").on(t.orgId, t.jobId, t.deletedAt),
    check("site_captures_source_ck", sql`${t.source} in ('aerial_trace_v1','manual')`),
    check("site_captures_surface_ck", sql`${t.surface} in ('flat','pitched')`),
    check(
      "site_captures_pitch_ck",
      sql`(${t.surface} = 'flat' and ${t.pitchRise} is null) or (${t.surface} = 'pitched' and ${t.pitchRise} between 1 and 24)`,
    ),
  ],
);

// Derived/overridden painting quantities for a room capture, one row per kind. value = the
// working number (null = needs_confirm); derivedValue preserves the original scan-derived
// number even after an override (null for manual rooms, which have no derivation).
export const paintingRoomQuantities = pgTable(
  "painting_room_quantities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    kind: text("kind").notNull(), // walls_sqft|ceiling_sqft|soffit_sqft|baseboard_lnft|crown_lnft|doors_count|windows_count
    value: numeric("value", { precision: 12, scale: 2, mode: "number" }), // null = needs_confirm
    derivedValue: numeric("derived_value", { precision: 12, scale: 2, mode: "number" }), // null for manual rooms
    status: text("status").notNull(), // derived|override|confirmed|needs_confirm
    // How tall the trim is, in inches — TYPED by the painter, never picked from a list, and only
    // meaningful on the two run kinds. A run is not the work: 38.4 ft of 3¼" colonial base and
    // 38.4 ft of 7" craftsman base are the same length and a different job. Null = never asked,
    // which is why the trim area is absent rather than zero.
    heightIn: numeric("height_in", { precision: 6, scale: 2, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("painting_room_quantities_org_id_uq").on(t.orgId, t.id),
    unique("painting_room_quantities_capture_kind_uq").on(t.orgId, t.captureId, t.kind),
    foreignKey({
      name: "painting_room_quantities_capture_fk",
      columns: [t.orgId, t.captureId],
      foreignColumns: [roomCaptures.orgId, roomCaptures.id],
    }).onDelete("cascade"),
    check(
      "painting_room_quantities_kind_ck",
      // soffit_sqft is MANUAL-ONLY and has no derivation: RoomPlan models walls, the floor and
      // openings, so a boxed soffit's faces and underside are not in the payload at all. It is the
      // painter's number or it is nothing.
      sql`${t.kind} in ('walls_sqft','ceiling_sqft','soffit_sqft','baseboard_lnft','crown_lnft','doors_count','windows_count')`,
    ),
    check(
      "painting_room_quantities_status_ck",
      sql`${t.status} in ('derived','override','confirmed','needs_confirm')`,
    ),
    // A height only exists on a RUN, and only at a size that is really trim. Zero is excluded
    // deliberately: "this room has no baseboard" is a confirmed zero RUN (the None control), not
    // a zero-height one — a zero here would price 38 feet of real base at nothing. Above 24" it
    // is wainscot or panelling, which is a wall surface, and much likelier a slip for 3.6.
    check(
      "painting_room_quantities_height_ck",
      sql`${t.heightIn} is null or (${t.kind} in ('baseboard_lnft','crown_lnft') and ${t.heightIn} > 0 and ${t.heightIn} <= 24)`,
    ),
  ],
);

// Wall area a room does NOT get painted, selected by TAP on the scan the painter already took.
//
// walls_sqft is reported GROSS (derive-painting.ts: openings are never deducted, because you cut
// in around a window and the cutting is the cost). Tile is the opposite — a band nobody paints and
// nobody cuts around. Before this the only lever was overriding walls_sqft with a hand-worked
// number, which lost the REASON; a deduction keeps it, so an estimate can show its own arithmetic.
//
// INPUTS ONLY. wall_indexes + height_m are what the painter chose; the square footage is derived
// server-side from the capture's geometry on every read, never trusted from the client — same law
// as site_captures.area_sqft. That also means a re-scan re-derives instead of going stale.
//
// kind='whole_wall' → height_m IS NULL (the whole wall goes). kind='band' → height_m is required
// (tile wainscot: Σ wall widths × height, clamped per wall). Enforced by check constraint, not by
// hope.
export const roomDeductions = pgTable(
  "room_deductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    captureId: uuid("capture_id").notNull(),
    reason: text("reason").notNull(), // "Tile wainscot", "Shower surround" — shown on the estimate
    kind: text("kind").notNull(), // 'whole_wall' | 'band'
    wallIndexes: jsonb("wall_indexes").notNull(), // int[] into NormalizedGeometry.walls
    heightM: numeric("height_m", { precision: 8, scale: 4, mode: "number" }), // band only
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("room_deductions_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "room_deductions_capture_fk",
      columns: [t.orgId, t.captureId],
      foreignColumns: [roomCaptures.orgId, roomCaptures.id],
    }).onDelete("cascade"),
    index("room_deductions_org_capture_idx").on(t.orgId, t.captureId, t.deletedAt),
    check("room_deductions_kind_ck", sql`${t.kind} in ('whole_wall','band')`),
    check(
      "room_deductions_height_ck",
      sql`(${t.kind} = 'whole_wall' and ${t.heightM} is null) or (${t.kind} = 'band' and ${t.heightM} > 0)`,
    ),
    check("room_deductions_reason_ck", sql`length(btrim(${t.reason})) between 1 and 60`),
  ],
);
