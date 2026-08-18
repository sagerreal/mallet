/**
 * lib/room-scene.ts
 * The capture's own geometry, projected into the RoomPlan-style dollhouse: floor first, back
 * walls solid, camera-side walls see-through so you look INTO the room. Pure math — the
 * component that renders this is dumb.
 *
 * FRAME-FREE, the #547 lesson: a capture may call any axis "up" (Owen's bathroom arrived z-up),
 * so nothing here reads .y and means "height". Up comes from the floor's normal; the two
 * horizontal axes come from the floor's own longest edge, so the room always sits square-ish to
 * the camera instead of at whatever angle the phone happened to start scanning.
 */

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SceneWallInput {
  readonly index: number;
  readonly vertices: readonly ScenePoint[];
}

export interface RoomSceneInput {
  readonly floor: readonly ScenePoint[];
  readonly walls: readonly SceneWallInput[];
}

export interface Projected {
  readonly x: number;
  readonly y: number;
}

export interface SceneWall {
  readonly index: number;
  readonly points: readonly Projected[];
  /** Faces the camera — drawn see-through so the room reads as a room, not a box. */
  readonly front: boolean;
  /** 0..1 lighting factor from the wall's orientation — what makes two white walls read as a corner. */
  readonly shade: number;
}

export interface RoomScene {
  readonly floor: { readonly points: readonly Projected[] };
  /** Far-to-near: rendering the array in order IS the painter's algorithm. */
  readonly walls: readonly SceneWall[];
  readonly viewBox: string;
  /** Screen units per metre — a 2.4 m wall rises 2.4 × scale pixels. */
  readonly scale: number;
}

const SCALE = 40; // px per metre — the svg viewBox scales to fit regardless.
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const MIN_POLYGON = 3;

type V3 = { x: number; y: number; z: number };
const sub = (a: ScenePoint, b: ScenePoint): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: ScenePoint | V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: V3): V3 => {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  return l === 0 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Newell normal — the same construction polygonArea takes the magnitude of. */
const newell = (v: readonly ScenePoint[]): V3 => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!;
    const b = v[(i + 1) % v.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return { x: nx, y: ny, z: nz };
};

const centroid = (v: readonly ScenePoint[]): V3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of v) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / v.length, y: y / v.length, z: z / v.length };
};

interface SceneFrame {
  readonly up: V3;
  readonly e1: V3;
  readonly e2: V3;
}

/**
 * The capture's frame: up from the floor's normal (same 0.02 epsilon as roomUp in
 * wall-deductions.ts — a sliver floor's noise normal falls back to y-up rather than being
 * normalized into a garbage direction), oriented so walls rise toward positive h; horizontal
 * basis from the floor's longest edge so the room sits square to the camera.
 */
function sceneFrame(input: RoomSceneInput, walls: readonly SceneWallInput[]): SceneFrame {
  const rawUp = newell(input.floor);
  const upLen = Math.sqrt(rawUp.x * rawUp.x + rawUp.y * rawUp.y + rawUp.z * rawUp.z);
  let up: V3 =
    upLen < 0.02
      ? { x: 0, y: 1, z: 0 }
      : { x: rawUp.x / upLen, y: rawUp.y / upLen, z: rawUp.z / upLen };
  const floorC = centroid(input.floor);
  const wallH =
    walls.length > 0
      ? walls.reduce(
          (s, w) => s + dot(up, sub(centroid(w.vertices) as ScenePoint, floorC as ScenePoint)),
          0,
        ) / walls.length
      : 1;
  if (wallH < 0) up = { x: -up.x, y: -up.y, z: -up.z };

  let e1: V3 = { x: 1, y: 0, z: 0 };
  let best = 0;
  for (let i = 0; i < input.floor.length; i++) {
    const a = input.floor[i]!;
    const b = input.floor[(i + 1) % input.floor.length]!;
    const d = sub(b, a);
    const flat: V3 = {
      x: d.x - dot(up, d) * up.x,
      y: d.y - dot(up, d) * up.y,
      z: d.z - dot(up, d) * up.z,
    };
    const l = Math.sqrt(flat.x * flat.x + flat.y * flat.y + flat.z * flat.z);
    if (l > best) {
      best = l;
      e1 = norm(flat);
    }
  }
  return { up, e1, e2: norm(cross(up, e1)) };
}

export function buildRoomScene(input: RoomSceneInput): RoomScene {
  // Vertex count alone admits a COLLAPSED wall — three collinear points project to a stroked
  // line that would render as a focusable, tappable "button". Zero Newell area is no wall.
  const walls = input.walls.filter((w) => {
    if (w.vertices.length < MIN_POLYGON) return false;
    const n = newell(w.vertices);
    return Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) >= 0.02;
  });

  const { up, e1, e2 } = sceneFrame(input, walls);

  // The floor's own footprint in horizontal coordinates, for orienting wall normals. The
  // previous scheme — flip the normal toward the room's CENTROID — is wrong for any concave
  // room: an L-shaped room's inner-leg wall can sit on the far side of the centroid from its
  // own outward direction, get force-flipped, and be drawn as an opaque wall ACROSS the leg
  // (verified numerically in review: any leg narrower than half the room). Point-in-polygon
  // against the floor itself has no such blind spot: step just outside the wall along its
  // normal — if that lands inside the floor, the normal was pointing into the room.
  const floorAB = input.floor.map((p) => ({ a: dot(e1, p), b: dot(e2, p) }));
  const insideFloor = (a: number, b: number): boolean => {
    let is = false;
    for (let i = 0; i < floorAB.length; i++) {
      const p = floorAB[i]!;
      const q = floorAB[(i + 1) % floorAB.length]!;
      if (p.b > b !== q.b > b && a < ((q.a - p.a) * (b - p.b)) / (q.b - p.b) + p.a) is = !is;
    }
    return is;
  };
  const PROBE_M = 0.15;

  const project = (p: ScenePoint): Projected => {
    const a = dot(e1, p);
    const b = dot(e2, p);
    const h = dot(up, p);
    return {
      x: Math.round((a - b) * COS30 * SCALE * 10) / 10,
      // Screen y grows downward: taller points get SMALLER y.
      y: Math.round(((a + b) * SIN30 - h) * SCALE * 10) / 10,
    };
  };
  const depth = (c: V3): number => dot(e1, c) + dot(e2, c);

  // Outward normal: Newell's, oriented by the floor — winding is the scanner's business, not
  // ours. Probe a step outside the wall along the normal's horizontal component; if that lands
  // inside the floor, the normal was pointing into the room. (Point-in-polygon, NOT the room's
  // centroid: the centroid test misclassifies any L-room whose leg is narrower than half the
  // room — verified numerically in review.)
  const outwardNormal = (vertices: readonly ScenePoint[], c: V3): V3 => {
    let n = norm(newell(vertices));
    const nh: V3 = {
      x: n.x - dot(up, n) * up.x,
      y: n.y - dot(up, n) * up.y,
      z: n.z - dot(up, n) * up.z,
    };
    const nhLen = Math.sqrt(nh.x * nh.x + nh.y * nh.y + nh.z * nh.z);
    if (nhLen > 1e-6) {
      const probeA = dot(e1, c) + (PROBE_M * dot(e1, nh)) / nhLen;
      const probeB = dot(e2, c) + (PROBE_M * dot(e2, nh)) / nhLen;
      if (insideFloor(probeA, probeB)) n = { x: -n.x, y: -n.y, z: -n.z };
    }
    return n;
  };
  // Fixed light from the camera's upper left: two white walls meeting in a corner pick up
  // different tones, which is the whole reading of the dollhouse.
  const light = norm({ x: e1.x - 0.4 * e2.x + 0.7 * up.x, y: e1.y - 0.4 * e2.y + 0.7 * up.y, z: e1.z - 0.4 * e2.z + 0.7 * up.z });

  const sceneWalls = walls
    .map((w) => {
      const c = centroid(w.vertices);
      const n = outwardNormal(w.vertices, c);
      // A wall whose outside faces the camera would hide the room — draw it see-through.
      const front = n.x * (e1.x + e2.x) + n.y * (e1.y + e2.y) + n.z * (e1.z + e2.z) > 0;
      const shade = Math.min(1, Math.max(0, (1 - dot(n, light)) / 2));
      return { index: w.index, points: w.vertices.map(project), front, shade, d: depth(c) };
    })
    // ONE painter's sort, by depth alone. The old two-tier sort (all solids, then all ghosts)
    // painted a ghost wall OVER a solid wall that physically stood in front of it whenever a
    // notch faced the camera — and SVG hit-testing follows paint order, so taps in the overlap
    // picked the hidden wall. Far-to-near handles both cases: back walls land first because
    // they ARE far, and an occluded ghost lands under the solid that hides it.
    .sort((a, b) => a.d - b.d)
    .map(({ index, points, front, shade }) => ({ index, points, front, shade }));

  const all = [...input.floor.map(project), ...sceneWalls.flatMap((w) => [...w.points])];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 12;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;

  return {
    floor: { points: input.floor.map(project) },
    walls: sceneWalls,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    scale: SCALE,
  };
}
