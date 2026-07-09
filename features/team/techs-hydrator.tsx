"use client";

/**
 * features/team/techs-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.identity.members and
 * writes field-crew members into the Zustand store as Tech objects.
 *
 * Only members where isFieldCrew === true become schedule-board lanes. In a
 * solo org the owner (if flagged as field crew) becomes the single lane.
 *
 * Retires SAMPLE_TECHS: data-slice now starts with techs: [] and this hydrator
 * fills it from the real DB.
 *
 * Color and initials are derived deterministically from the member's id so they
 * are stable across page loads and consistent across clients.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Tech } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

type MemberDTO = RouterOutputs["v1"]["identity"]["members"]["items"][number];

// A small palette of visually distinct hues. The palette index is derived from
// the member's UUID so the color is stable even if the member list re-orders.
const TECH_COLORS = [
  "#9C5B34", // warm brown
  "#1d4ed8", // blue
  "#b45309", // amber
  "#0f766e", // teal
  "#7c3aed", // violet
  "#be185d", // pink
  "#15803d", // green
  "#c2410c", // orange
];

/**
 * Cheap deterministic hash of a string → non-negative integer.
 * Used for color + initials index selection.
 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function deriveColor(id: string): string {
  return TECH_COLORS[hashString(id) % TECH_COLORS.length] ?? TECH_COLORS[0] ?? "#1d4ed8";
}

/**
 * Derive initials from a display name or email fallback.
 * - "Mike Rivera" → "MR"
 * - "mike.rivera@co.com" → "MR" (split on "." and "@")
 * - "alice" → "AL" (first two chars, uppercased)
 */
function deriveInitials(nameOrEmail: string): string {
  const parts = nameOrEmail
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "");

  if (parts.length >= 2) return (parts[0] ?? "") + (parts[1] ?? "");
  const raw = nameOrEmail.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return raw.slice(0, 2) || "??";
}

function toStoreTech(member: MemberDTO): Tech {
  // Prefer a real name; otherwise the email local part ("owenduggan2003"), never
  // the full address — the board lane is narrow and the domain adds no signal.
  const displayName = member.name ?? member.email.split("@")[0] ?? member.email;
  return {
    id: member.id,
    name: displayName,
    initials: deriveInitials(displayName),
    color: deriveColor(member.id),
    skills: [],
    wage: 0,
  };
}

// Module-level stable transform — required by useStoreHydrator dep tracking.
const transformFieldCrewMember = (member: MemberDTO): Tech => toStoreTech(member);

export function TechsHydrator() {
  const setTechs = useAppStore((s) => s.setTechs);
  const { data, isError, error } = api.v1.identity.members.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: true,
  });

  // Filter to field crew only before handing to useStoreHydrator.
  // useStoreHydrator expects { items, nextCursor } — build a synthetic page.
  const fieldCrewPage =
    data
      ? {
          items: data.items.filter((m) => m.isFieldCrew),
          nextCursor: null as string | null,
        }
      : undefined;

  useStoreHydrator({
    data: fieldCrewPage,
    isError,
    error,
    transform: transformFieldCrewMember,
    setSlice: setTechs,
    label: "techs",
  });

  return null;
}
