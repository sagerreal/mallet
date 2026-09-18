"use client";

/**
 * components/modals/room-scan-view.tsx
 * The scan, viewable: the capture's own wall polygons drawn as the RoomPlan-style dollhouse —
 * floor, back walls solid, camera-side walls see-through — with every wall tappable. Tap one
 * and its caption prints the SAME line the breakdown and the deduction picker print (wallLabel:
 * one string for a wall everywhere), plus the doors and windows the scanner saw on that wall.
 *
 * WHAT THIS REFUSES TO DRAW. RoomPlan's furniture boxes (we never stored object meshes) and
 * door/window POSITIONS along a wall (the capture records which wall and what size — not where).
 * Openings are therefore facts in the tapped wall's caption, never rectangles at invented spots.
 *
 * Geometry loads on open through its own endpoint (the list DTO stays light), projected by
 * lib/room-scene.ts — pure math, frame-free per #547's lesson.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { buildRoomScene } from "@/lib/room-scene";
import { wallLabel, wallDidNotCapture, feetInches } from "./wall-breakdown";
import type { RoomWall } from "@/lib/store/types";

export interface RoomScanViewProps {
  captureId: string;
  /** The same per-wall dims the breakdown shows — captions come from here, matched by index. */
  walls: readonly RoomWall[];
}

function openingsCaption(
  openings: readonly {
    kind: "door" | "window" | "opening";
    wallIndex: number | null;
    widthFt: number;
    heightFt: number;
  }[],
  index: number,
): string | null {
  // Each opening with its SIZE — "1 door" alone was a fact withheld; the width and height were
  // in the geometry all along. Still never a position: the scan records wall + size, not where.
  const here = openings.filter((o) => o.wallIndex === index && o.kind !== "opening");
  if (here.length === 0) return null;
  return here
    .map((o) => `${o.kind} ${feetInches(o.widthFt)} × ${feetInches(o.heightFt)}`)
    .join(" · ");
}

function SceneWallPolygon({
  wall,
  picked,
  onPick,
}: {
  wall: { index: number; points: readonly { x: number; y: number }[]; front: boolean; shade: number };
  picked: boolean;
  onPick: (index: number) => void;
}) {
  const points = wall.points.map((p) => `${p.x},${p.y}`).join(" ");
  // Orientation-shaded whites — the same color-mix trick --shadow-focus uses, tokens only.
  const solidFill = `color-mix(in srgb, var(--ink) ${Math.round(4 + wall.shade * 9)}%, var(--card))`;
  return (
    <polygon
      points={points}
      role="button"
      tabIndex={0}
      aria-label={`Wall ${wall.index + 1}`}
      aria-pressed={picked}
      onClick={() => onPick(wall.index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(wall.index);
        }
      }}
      style={{
        cursor: "pointer",
        fill: picked ? "var(--accent)" : wall.front ? "var(--card)" : solidFill,
        fillOpacity: picked ? 0.28 : wall.front ? 0.12 : 1,
        stroke: picked ? "var(--accent)" : "var(--line)",
        strokeWidth: picked ? 2 : 1,
        strokeLinejoin: "round",
      }}
    />
  );
}

export function RoomScanView({ captureId, walls }: RoomScanViewProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const geometry = api.v1.measurements.roomGeometry.useQuery(
    { captureId },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );

  if (geometry.isLoading) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0" }}>
        Loading the scan…
      </p>
    );
  }
  if (geometry.isError || !geometry.data) {
    return (
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0" }}>
        Couldn&apos;t load the scan.{" "}
        <button type="button" className="linklike" onClick={() => void geometry.refetch()}>
          Try again
        </button>
      </p>
    );
  }

  const scene = buildRoomScene(geometry.data);
  const dims = new Map(walls.map((w) => [w.index, w]));
  const picked = selected != null ? dims.get(selected) : undefined;
  const openings = selected != null ? openingsCaption(geometry.data.openings, selected) : null;

  const pts = (points: readonly { x: number; y: number }[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div style={{ margin: "0 0 var(--space-3)" }}>
      <svg
        viewBox={scene.viewBox}
        // "group", never "img": the img role marks CHILDREN PRESENTATIONAL, which prunes the
        // wall polygons' button semantics from the accessibility tree — focus stops with no
        // name, no role, no way to pick a wall.
        role="group"
        aria-label="Scanned room"
        style={{ width: "100%", maxHeight: 260, display: "block" }}
      >
        <polygon
          points={pts(scene.floor.points)}
          style={{ fill: "var(--line-2)", stroke: "var(--line)", strokeWidth: 1 }}
        />
        {scene.walls.map((w) => (
          <SceneWallPolygon
            key={w.index}
            wall={w}
            picked={selected === w.index}
            onPick={(i) => setSelected(selected === i ? null : i)}
          />
        ))}
      </svg>
      <p
        aria-live="polite"
        className={picked ? undefined : "muted"}
        style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0", fontWeight: picked ? 600 : 400 }}
      >
        {picked
          ? wallDidNotCapture(picked)
            ? `Wall ${picked.index + 1} · didn't capture`
            : picked.overrideSqft != null
              ? `Wall ${picked.index + 1} · ${picked.overrideSqft.toFixed(1)} sq ft · edited · measured ${picked.sqft.toFixed(1)}${openings ? ` · ${openings}` : ""}`
              : `${wallLabel(picked)}${openings ? ` · ${openings}` : ""}`
          : "Tap a wall to see its measurements."}
      </p>
    </div>
  );
}
