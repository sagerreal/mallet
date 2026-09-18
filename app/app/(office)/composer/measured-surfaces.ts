/**
 * app/(office)/composer/measured-surfaces.ts
 *
 * Pure derive logic for the composer's "Measure" panel — the office door to a
 * job's measurements (the job modal's measure and site blocks are gone; the
 * tech field Quote tab keeps its scan row). Everything here is plain
 * data-in/data-out so the panel's
 * visibility rules, job resolution and row summaries are unit-testable without
 * mounting the component:
 *
 *   - which of the customer's jobs the panel reads (?job= wins; else the
 *     office's pick; else the candidate with the most captures)
 *   - when the in-flow job selector row shows (2+ jobs with captures)
 *   - one-line row summaries ("640 sqft · 104 lnft · traced Aug 1")
 *   - the seed-once key that keeps "Seed lines" from duplicating lines
 */

import type { Job, RoomCard, RoomQuantity, SiteCard } from "@/lib/store/types";
import { formatDate } from "@/lib/format";
import { formatSqft, formatLnft, pitchLabel } from "@/lib/measure/aerial-geometry";
import { edgeReadout } from "@/lib/measure/edge-classes";

// ---- job resolution --------------------------------------------------------

/** The lead's jobs the panel may read measurements from (archived jobs are out). */
export function candidateJobsForLead(jobs: readonly Job[], leadId: string | null): Job[] {
  if (!leadId) return [];
  return jobs.filter((j) => j.leadId === leadId && !j.archived);
}

/**
 * A job's known capture count, or null while its measurements haven't hydrated
 * yet (`undefined` slice = never fetched — distinct from `[]`, a real zero).
 */
export function jobCaptureCount(
  rooms: readonly RoomCard[] | undefined,
  sites: readonly SiteCard[] | undefined,
): number | null {
  if (rooms === undefined && sites === undefined) return null;
  return (rooms?.length ?? 0) + (sites?.length ?? 0);
}

export interface ResolvePanelJobArgs {
  /** ?job= from the URL — the "Build the price" boot. Authoritative when present. */
  readonly paramJobId: string | null;
  /** The job the office picked in the selector row this session, if any. */
  readonly chosenJobId: string | null;
  readonly candidates: readonly Job[];
  /** Known capture count per candidate job id; null = not hydrated yet. */
  readonly countFor: (jobId: string) => number | null;
}

/**
 * Which job the panel reads. ?job= always wins (that boot already seeded the
 * composer from this exact job). Otherwise the office's explicit pick sticks
 * while it's still one of the lead's jobs. Otherwise: the candidate with the
 * most KNOWN captures; when none has any (or counts are still unknown), the
 * first candidate — the panel still needs a home for "+ Trace from satellite".
 * Null only when there is no job context at all (panel hidden).
 */
export function resolvePanelJob(args: ResolvePanelJobArgs): string | null {
  if (args.paramJobId) return args.paramJobId;
  if (args.chosenJobId && args.candidates.some((j) => j.id === args.chosenJobId)) {
    return args.chosenJobId;
  }
  const first = args.candidates[0];
  if (!first) return null;
  let best: Job = first;
  let bestCount = args.countFor(best.id) ?? 0;
  for (const job of args.candidates.slice(1)) {
    const count = args.countFor(job.id) ?? 0;
    if (count > bestCount) {
      best = job;
      bestCount = count;
    }
  }
  return best.id;
}

export interface PanelJobOption {
  readonly jobId: string;
  readonly title: string;
  readonly captureCount: number;
}

/**
 * The compact in-flow selector's options: the lead's jobs that actually HAVE
 * captures. The selector renders only when there are 2+ (one job with captures
 * needs no chooser; a ?job= boot pins the job, so no selector then either).
 */
export function panelJobOptions(
  candidates: readonly Job[],
  countFor: (jobId: string) => number | null,
): PanelJobOption[] {
  return candidates
    .map((j) => ({ jobId: j.id, title: j.title, captureCount: countFor(j.id) ?? 0 }))
    .filter((o) => o.captureCount > 0);
}

// ---- rows ------------------------------------------------------------------

export interface MeasuredRow {
  /** Seed-filter key AND display name: the capture's stored name. */
  readonly name: string;
  readonly kind: "room" | "site";
  /** Key figures + capture date — "640 sqft · 104 lnft · traced Aug 1". */
  readonly summary: string;
  /** The capture id — "Open" drills into the saved trace (site) or the room card (room). */
  readonly captureId?: string;
  /** Room rows: true when any quantity is awaiting office confirmation. */
  readonly needsConfirm?: boolean;
}

/** True when any quantity on the room is awaiting office confirmation. */
export function roomNeedsConfirm(quantities: readonly RoomQuantity[]): boolean {
  return quantities.some((q) => q.status === "needs_confirm");
}

/**
 * The room figures line ("562 sqft walls · 2 doors") — formerly roomHeadline
 * in the deleted job-measure-block; the composer's Measure panel is the rooms
 * home now, so the derive lives here, pure.
 */
function roomFigures(quantities: readonly RoomQuantity[]): string {
  const value = (kind: RoomQuantity["kind"]): number | null => {
    const q = quantities.find((x) => x.kind === kind);
    if (!q) return null;
    return q.value ?? q.derivedValue ?? null;
  };
  const parts: string[] = [];
  const walls = value("walls_sqft");
  if (walls != null) parts.push(`${walls} sqft walls`);
  const doors = value("doors_count");
  if (doors != null) parts.push(`${doors} door${doors === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "Not measured yet";
}

export function roomRowSummary(room: Pick<RoomCard, "quantities" | "capturedAt">): string {
  return `${roomFigures(room.quantities)} · measured ${formatDate(room.capturedAt)}`;
}

export function siteRowSummary(
  site: Pick<SiteCard, "surface" | "pitchRise" | "areaSqft" | "perimeterLnft" | "edges" | "createdAt">,
): string {
  const area =
    site.surface === "pitched" && site.pitchRise !== null
      ? `${formatSqft(site.areaSqft)} at ${pitchLabel(site.pitchRise)}`
      : formatSqft(site.areaSqft);
  const parts = [area];
  // A classified PITCHED surface shows its per-class linears ("Eaves 160 ft ·
  // Ridge 40 ft") in place of the bare perimeter; flat and legacy captures
  // keep the perimeter figure.
  const classed = site.surface === "pitched" && site.edges !== null ? edgeReadout(site.edges) : "";
  if (classed !== "") {
    parts.push(classed);
  } else if (site.perimeterLnft !== null) {
    parts.push(formatLnft(site.perimeterLnft));
  }
  parts.push(`traced ${formatDate(site.createdAt)}`);
  return parts.join(" · ");
}

/** Rooms first, then traced surfaces — the same order buildFromMeasurements seeds in. */
export function panelRows(
  rooms: readonly RoomCard[],
  sites: readonly SiteCard[],
): MeasuredRow[] {
  return [
    ...rooms.map<MeasuredRow>((r) => ({
      name: r.roomName,
      kind: "room",
      summary: roomRowSummary(r),
      captureId: r.id,
      needsConfirm: roomNeedsConfirm(r.quantities),
    })),
    ...sites.map<MeasuredRow>((s) => ({
      name: s.name,
      kind: "site",
      summary: siteRowSummary(s),
      captureId: s.id,
    })),
  ];
}

// ---- seed-once -------------------------------------------------------------

/**
 * One "Seed lines" per surface per job: the key the page tracks after a
 * successful seed. Re-seeding would duplicate lines, so the button disables
 * once its key is in the seeded set (a ?job= boot marks the WHOLE job seeded —
 * the boot already dropped every surface's lines into the table).
 */
export function seedKey(jobId: string, name: string): string {
  return `${jobId}::${name.trim()}`;
}

// Measurement-notice copy — moved from composer-state.ts (file-cap). Same exports, re-exported
// there so import sites are unchanged.
export interface MeasurementGap {
  kind: string;
  label: string;
}

/** Quiet inline notice copy for a pricebook gap — informational, no dead link v1. */
export function gapNoticeText(gap: MeasurementGap): string {
  return `No rate set for ${gap.label} — add one in the Pricebook.`;
}

/** Quiet inline notice copy for rooms whose only trace is "unconfirmed" (no line, no gap). */
export function unconfirmedRoomsNoticeText(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? "room has" : "rooms have";
  return `${count} ${noun} unconfirmed measurements — confirm them on the job before sending.`;
}
