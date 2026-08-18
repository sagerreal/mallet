/**
 * lib/room-scene.test.ts
 *
 * The scan viewer's projection: the capture's own wall polygons, drawn as the RoomPlan-style
 * dollhouse — floor first, back walls solid, camera-side walls see-through so the room reads
 * as a room. Pure math, no DOM.
 *
 * THE FRAME LESSON FROM #547 APPLIES HERE TOO: a capture may arrive y-up or z-up, and the
 * scene must not care. These tests build the SAME room in both frames and demand the same
 * shapes come out.
 */
import { describe, it, expect } from "vitest";
import { buildRoomScene, type ScenePoint } from "./room-scene";

// A 4 m × 3 m room, 2.4 m tall, four rectangular walls — y is up.
const P = (x: number, y: number, z: number): ScenePoint => ({ x, y, z });
const Y_UP_ROOM = {
  floor: [P(0, 0, 0), P(4, 0, 0), P(4, 0, 3), P(0, 0, 3)],
  walls: [
    { index: 0, vertices: [P(0, 0, 0), P(4, 0, 0), P(4, 2.4, 0), P(0, 2.4, 0)] },
    { index: 1, vertices: [P(4, 0, 0), P(4, 0, 3), P(4, 2.4, 3), P(4, 2.4, 0)] },
    { index: 2, vertices: [P(4, 0, 3), P(0, 0, 3), P(0, 2.4, 3), P(4, 2.4, 3)] },
    { index: 3, vertices: [P(0, 0, 3), P(0, 0, 0), P(0, 2.4, 0), P(0, 2.4, 3)] },
  ],
};
// The identical room with axes renamed so z is up — the Aug 18 bathroom's frame.
const flip = (p: ScenePoint): ScenePoint => ({ x: p.x, y: p.z, z: p.y });
const Z_UP_ROOM = {
  floor: Y_UP_ROOM.floor.map(flip),
  walls: Y_UP_ROOM.walls.map((w) => ({ index: w.index, vertices: w.vertices.map(flip) })),
};

const polyExtent = (points: readonly { x: number; y: number }[]) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

describe("buildRoomScene", () => {
  it("projects every wall and the floor", () => {
    const scene = buildRoomScene(Y_UP_ROOM);

    expect(scene.walls).toHaveLength(4);
    expect(scene.floor.points).toHaveLength(4);
    for (const w of scene.walls) expect(w.points).toHaveLength(4);
  });

  it("marks exactly two walls camera-side (translucent) and two solid, in any frame", () => {
    for (const room of [Y_UP_ROOM, Z_UP_ROOM]) {
      const scene = buildRoomScene(room);
      expect(scene.walls.filter((w) => w.front)).toHaveLength(2);
    }
  });

  it("orders walls far-to-near so the painter's algorithm just draws the array", () => {
    const scene = buildRoomScene(Y_UP_ROOM);
    const solidPositions = scene.walls.map((w, i) => ({ i, front: w.front }));
    const lastSolid = Math.max(...solidPositions.filter((p) => !p.front).map((p) => p.i));
    const firstFront = Math.min(...solidPositions.filter((p) => p.front).map((p) => p.i));

    expect(lastSolid).toBeLessThan(firstFront);
  });

  it("draws the same shapes whichever way the capture calls up (#547's frame lesson)", () => {
    const a = buildRoomScene(Y_UP_ROOM);
    const b = buildRoomScene(Z_UP_ROOM);

    for (const wa of a.walls) {
      const wb = b.walls.find((w) => w.index === wa.index)!;
      const ea = polyExtent(wa.points);
      const eb = polyExtent(wb.points);
      // Coordinates are rounded to 0.1 px, so two frames can disagree by one rounding step —
      // half a pixel is "the same shape" at any zoom a phone will ever show this at.
      expect(ea.w).toBeCloseTo(eb.w, 0);
      expect(ea.h).toBeCloseTo(eb.h, 0);
    }
  });

  it("keeps a wall's on-screen height equal to its real height at the scene scale", () => {
    const scene = buildRoomScene(Y_UP_ROOM);
    // In an isometric projection, vertical extent maps 1:1 (× scale). A 2.4 m wall on a
    // 3 m-deep footprint: screen height = 2.4·s + depth·sin30·s only if slanted — the PURE
    // vertical difference between a wall's top and bottom edge midpoints is 2.4·s.
    const w = scene.walls.find((x) => x.index === 0)!;
    const ys = w.points.map((p) => p.y).sort((m, n) => m - n);
    const rise = ys[3]! - ys[0]!;
    expect(rise).toBeGreaterThanOrEqual(2.4 * scene.scale - 0.2);
  });

  it("skips a degenerate wall rather than projecting a sliver", () => {
    const scene = buildRoomScene({
      floor: Y_UP_ROOM.floor,
      walls: [...Y_UP_ROOM.walls, { index: 4, vertices: [P(0, 0, 0), P(1, 0, 0)] }],
    });

    expect(scene.walls).toHaveLength(4);
    expect(scene.walls.some((w) => w.index === 4)).toBe(false);
  });

  it("emits a viewBox that contains every projected point", () => {
    const scene = buildRoomScene(Y_UP_ROOM);
    const [minX, minY, w, h] = scene.viewBox.split(" ").map(Number);
    const all = [...scene.floor.points, ...scene.walls.flatMap((x) => x.points)];

    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(minX!);
      expect(p.y).toBeGreaterThanOrEqual(minY!);
      expect(p.x).toBeLessThanOrEqual(minX! + w!);
      expect(p.y).toBeLessThanOrEqual(minY! + h!);
    }
  });
});

describe("wall shading", () => {
  it("gives two adjacent solid walls different tones — the corner has to read", () => {
    const scene = buildRoomScene(Y_UP_ROOM);
    const solid = scene.walls.filter((w) => !w.front);

    expect(solid).toHaveLength(2);
    expect(Math.abs(solid[0]!.shade - solid[1]!.shade)).toBeGreaterThan(0.05);
    for (const w of scene.walls) {
      expect(w.shade).toBeGreaterThanOrEqual(0);
      expect(w.shade).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// CONCAVE ROOMS — the review's counterexamples, kept as fixtures. The centroid-based normal
// orientation misclassified any L-room whose leg is narrower than half the room; the two-tier
// depth sort painted a ghost wall over the solid wall physically in front of it. Both were
// verified numerically before being fixed, and these pin the fix.
// ---------------------------------------------------------------------------

/** A vertical wall on the floor edge a→b, h metres tall, y-up. */
const wallOn = (index: number, a: [number, number], b: [number, number], h = 2.4) => ({
  index,
  vertices: [
    P(a[0], 0, a[1]),
    P(b[0], 0, b[1]),
    P(b[0], h, b[1]),
    P(a[0], h, a[1]),
  ],
});
const roomFromFloor = (corners: [number, number][]) => ({
  floor: corners.map(([x, z]) => P(x, 0, z)),
  walls: corners.map((c, i) => wallOn(i, c, corners[(i + 1) % corners.length]!)),
});

describe("concave (L-shaped) rooms", () => {
  it("classifies the inner leg's camera-side wall as see-through, not a wall across the leg", () => {
    // 5×4 m with a 2.7-wide notch leaving a 2.3 m leg — leg < half the room, the exact shape
    // the centroid trick force-flipped. Wall 3 sits on (2.3,2)→(2.3,4): its outside faces the
    // notch (toward the camera), so it must be a ghost you look through into the leg.
    const scene = buildRoomScene(
      roomFromFloor([[0, 0], [5, 0], [5, 2], [2.3, 2], [2.3, 4], [0, 4]]),
    );

    expect(scene.walls.find((w) => w.index === 3)!.front).toBe(true);
  });

  it("paints an occluded ghost wall UNDER the solid wall that physically hides it", () => {
    // 7×4 m with a 2×1.5 m notch toward the camera. Wall 3 (x=5 face, a ghost deep in the
    // notch) stands BEHIND wall 2 (the z=2.5 solid): far-to-near must draw 3 before 2, or the
    // ghost's stroke floats across the solid and taps in the overlap pick the hidden wall.
    const scene = buildRoomScene(
      roomFromFloor([[0, 0], [7, 0], [7, 2.5], [5, 2.5], [5, 4], [0, 4]]),
    );

    const pos = (i: number) => scene.walls.findIndex((w) => w.index === i);
    expect(scene.walls.find((w) => w.index === 3)!.front).toBe(true);
    expect(scene.walls.find((w) => w.index === 2)!.front).toBe(false);
    expect(pos(3)).toBeLessThan(pos(2));
  });
});

describe("degenerate geometry the scanner really produces", () => {
  it("skips a collapsed wall (collinear vertices) — a line is not a tappable wall", () => {
    const scene = buildRoomScene({
      floor: Y_UP_ROOM.floor,
      walls: [...Y_UP_ROOM.walls, { index: 9, vertices: [P(0, 0, 0), P(1, 0.5, 0), P(2, 1, 0)] }],
    });

    expect(scene.walls.some((w) => w.index === 9)).toBe(false);
  });

  it("falls back to y-up on a sliver floor instead of normalizing noise (roomUp's epsilon)", () => {
    // A 6 m near-collinear strip with a 3 mm bow: Newell length ≈ 0.018 — under the same 0.02
    // guard roomUp uses. Walls must still render upright, not lying on their sides.
    const scene = buildRoomScene({
      floor: [P(0, 0, 0), P(3, 0, 0.003), P(6, 0, 0)],
      walls: [Y_UP_ROOM.walls[0]!],
    });

    const w = scene.walls[0]!;
    const ys = w.points.map((p) => p.y).sort((m, n) => m - n);
    expect(ys[3]! - ys[0]!).toBeGreaterThanOrEqual(2.4 * scene.scale - 0.2);
  });
});
