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
  ],
);
