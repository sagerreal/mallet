import { z } from "zod";
import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// The normalized geometry wire format — SI meters, snake_case (matches the RoomPlan capture
// payload after on-device normalization). Parsed here into a camelCase domain shape so nothing
// downstream touches the wire naming.
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Polygon3 {
  readonly vertices: readonly Point3[];
}

export type OpeningKind = "door" | "window" | "opening";

export interface Opening {
  readonly kind: OpeningKind;
  readonly width: number;
  readonly height: number;
  readonly wallIndex: number | null;
}

export interface Wall {
  readonly polygon: Polygon3;
}

// null area/wallTopSpread and isVaulted=true both mean "don't guess" — surfaced as
// needs_confirm by derive-painting, never silently defaulted.
export interface CeilingInfo {
  readonly area: number | null;
  readonly isVaulted: boolean;
  readonly wallTopSpread: number | null;
  readonly provenance: string | null;
}

export interface NormalizedGeometry {
  readonly floorPolygon: Polygon3;
  readonly walls: readonly Wall[];
  readonly openings: readonly Opening[];
  readonly ceiling: CeilingInfo | null;
}

const finite = () => z.number().finite();

const pointSchema = z.object({
  x: finite(),
  y: finite(),
  z: finite(),
});

const polygonSchema = z.object({
  vertices: z.array(pointSchema),
});

const openingSchema = z.object({
  kind: z.enum(["door", "window", "opening"]),
  width: finite().nonnegative(),
  height: finite().nonnegative(),
  wall_index: z.number().int().nonnegative().nullish(),
});

const wallSchema = z.object({
  polygon: polygonSchema,
});

const ceilingSchema = z
  .object({
    area: finite().nonnegative().nullable(),
    is_vaulted: z.boolean(),
    wall_top_spread: finite().nullable().optional(),
    provenance: z.string().nullable().optional(),
  })
  .nullable();

const wireSchema = z.object({
  floor_polygon: polygonSchema,
  walls: z.array(wallSchema),
  openings: z.array(openingSchema),
  ceiling: ceilingSchema,
});

const MIN_POLYGON_VERTICES = 3;

/** Parses the untrusted wire payload into a NormalizedGeometry, or a named ValidationError. */
export function parseNormalizedGeometry(input: unknown): Result<NormalizedGeometry, ValidationError> {
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || undefined;
    return err(validation(issue?.message ?? "invalid geometry payload", field));
  }

  const data = parsed.data;
  if (data.floor_polygon.vertices.length < MIN_POLYGON_VERTICES) {
    return err(validation("floor_polygon requires at least 3 vertices", "floor_polygon.vertices"));
  }

  return ok({
    floorPolygon: data.floor_polygon,
    walls: data.walls.map((w) => ({ polygon: w.polygon })),
    openings: data.openings.map((o) => ({
      kind: o.kind,
      width: o.width,
      height: o.height,
      wallIndex: o.wall_index ?? null,
    })),
    ceiling: data.ceiling
      ? {
          area: data.ceiling.area,
          isVaulted: data.ceiling.is_vaulted,
          wallTopSpread: data.ceiling.wall_top_spread ?? null,
          provenance: data.ceiling.provenance ?? null,
        }
      : null,
  });
}

// Newell's method: |Σ vᵢ × vᵢ₊₁| / 2 — plane-true area for any planar polygon, including
// tilted walls. Ported exactly from
// mallet-ios/capture/MalletCapture/Sources/MalletCaptureCore/Geometry.swift.
export function polygonArea(vertices: readonly Point3[]): number {
  if (vertices.length < MIN_POLYGON_VERTICES) return 0;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

export function polygonPerimeter(vertices: readonly Point3[]): number {
  if (vertices.length < 2) return 0;

  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}
