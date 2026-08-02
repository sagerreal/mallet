/**
 * app/(office)/composer/measured-surfaces.test.ts
 *
 * The "Measured surfaces" panel's derive logic: which of the lead's jobs the
 * panel reads (?job= wins; else the office's pick; else most captures), when
 * the in-flow job selector shows (2+ jobs with captures), row summaries, and
 * the seed-once key.
 */
import { describe, it, expect } from "vitest";
import type { Job, RoomCard, SiteCard } from "@/lib/store/types";
import {
  candidateJobsForLead,
  jobCaptureCount,
  panelJobOptions,
  panelRows,
  resolvePanelJob,
  roomNeedsConfirm,
  roomRowSummary,
  seedKey,
  siteRowSummary,
} from "./measured-surfaces";

const job = (overrides: Partial<Job>): Job =>
  ({
    id: "j1",
    leadId: "lead-1",
    title: "Repaint interior",
    archived: false,
    ...overrides,
  }) as Job;

const site = (overrides: Partial<SiteCard> = {}): SiteCard => ({
  id: "s1",
  jobId: "j1",
  name: "Driveway",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  areaSqft: 640,
  footprintSqft: 640,
  perimeterLnft: 104,
  polygon: null,
  edges: null,
  complexity: null,
  createdAt: "2026-08-01T12:00:00.000Z",
  ...overrides,
});

const room = (overrides: Partial<RoomCard> = {}): RoomCard => ({
  id: "r1",
  jobId: "j1",
  roomName: "Living Room",
  source: "manual",
  capturedAt: "2026-07-30T12:00:00.000Z",
  quantities: [
    { kind: "walls_sqft", value: null, derivedValue: 562, status: "derived" },
    { kind: "doors_count", value: 2, derivedValue: null, status: "confirmed" },
  ],
  ...overrides,
});

describe("candidateJobsForLead", () => {
  it("returns the lead's non-archived jobs only", () => {
    const jobs = [
      job({ id: "a" }),
      job({ id: "b", archived: true }),
      job({ id: "c", leadId: "other" }),
    ];
    expect(candidateJobsForLead(jobs, "lead-1").map((j) => j.id)).toEqual(["a"]);
  });

  it("no lead → no candidates", () => {
    expect(candidateJobsForLead([job({})], null)).toEqual([]);
  });
});

describe("jobCaptureCount", () => {
  it("null while NEITHER slice has hydrated (unknown, not zero)", () => {
    expect(jobCaptureCount(undefined, undefined)).toBeNull();
  });

  it("sums rooms + sites once anything hydrated", () => {
    expect(jobCaptureCount([room()], [site(), site({ id: "s2" })])).toBe(3);
    expect(jobCaptureCount([], undefined)).toBe(0);
  });
});

describe("resolvePanelJob", () => {
  const countOf = (counts: Record<string, number | null>) => (id: string) => counts[id] ?? null;

  it("?job= wins even when the lead has other jobs", () => {
    expect(
      resolvePanelJob({
        paramJobId: "pinned",
        chosenJobId: "a",
        candidates: [job({ id: "a" }), job({ id: "b" })],
        countFor: countOf({ a: 5, b: 1 }),
      }),
    ).toBe("pinned");
  });

  it("the office's pick sticks while it is still one of the lead's jobs", () => {
    expect(
      resolvePanelJob({
        paramJobId: null,
        chosenJobId: "b",
        candidates: [job({ id: "a" }), job({ id: "b" })],
        countFor: countOf({ a: 5, b: 1 }),
      }),
    ).toBe("b");
  });

  it("a stale pick (job no longer the lead's) falls through to the capture ranking", () => {
    expect(
      resolvePanelJob({
        paramJobId: null,
        chosenJobId: "gone",
        candidates: [job({ id: "a" }), job({ id: "b" })],
        countFor: countOf({ a: 1, b: 4 }),
      }),
    ).toBe("b");
  });

  it("defaults to the candidate with the most known captures; ties keep store order", () => {
    expect(
      resolvePanelJob({
        paramJobId: null,
        chosenJobId: null,
        candidates: [job({ id: "a" }), job({ id: "b" }), job({ id: "c" })],
        countFor: countOf({ a: 2, b: 2, c: null }),
      }),
    ).toBe("a");
  });

  it("no captures anywhere still resolves a job (the trace entry needs a home)", () => {
    expect(
      resolvePanelJob({
        paramJobId: null,
        chosenJobId: null,
        candidates: [job({ id: "a" })],
        countFor: countOf({ a: 0 }),
      }),
    ).toBe("a");
  });

  it("null when there is no job context at all — the panel hides", () => {
    expect(
      resolvePanelJob({ paramJobId: null, chosenJobId: null, candidates: [], countFor: () => null }),
    ).toBeNull();
  });
});

describe("panelJobOptions", () => {
  it("only jobs with known captures become selector options", () => {
    const options = panelJobOptions(
      [job({ id: "a", title: "Repaint" }), job({ id: "b", title: "Roof" }), job({ id: "c" })],
      (id) => ({ a: 2, b: 1, c: 0 })[id] ?? null,
    );
    expect(options).toEqual([
      { jobId: "a", title: "Repaint", captureCount: 2 },
      { jobId: "b", title: "Roof", captureCount: 1 },
    ]);
  });
});

describe("siteRowSummary", () => {
  it("flat: area · perimeter · traced date", () => {
    expect(siteRowSummary(site())).toBe("640 sqft · 104 lnft · traced Aug 1");
  });

  it("pitched: names the pitch on the corrected area", () => {
    expect(siteRowSummary(site({ surface: "pitched", pitchRise: 6, areaSqft: 1431 }))).toBe(
      "1,431 sqft at 6/12 · 104 lnft · traced Aug 1",
    );
  });

  it("manual entries without a perimeter omit it, never showing 0", () => {
    expect(siteRowSummary(site({ source: "manual", perimeterLnft: null }))).toBe(
      "640 sqft · traced Aug 1",
    );
  });

  it("a CLASSIFIED pitched surface shows classed linears in place of the perimeter", () => {
    expect(
      siteRowSummary(
        site({
          surface: "pitched",
          pitchRise: 6,
          areaSqft: 2420,
          edges: { eaveFt: 160.4, rakeFt: 99.6, ridgeFt: 40, hipFt: 0, valleyFt: 0 },
        }),
      ),
    ).toBe("2,420 sqft at 6/12 · Eaves 160 ft · Rakes 100 ft · Ridge 40 ft · traced Aug 1");
  });

  it("a FLAT surface ignores stray edge totals — classes are a pitched concept", () => {
    expect(
      siteRowSummary(
        site({ edges: { eaveFt: 100, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0 } }),
      ),
    ).toBe("640 sqft · 104 lnft · traced Aug 1");
  });
});

describe("roomRowSummary", () => {
  it("mirrors the rooms block's headline plus the capture date", () => {
    expect(roomRowSummary(room())).toBe("562 sqft walls · 2 doors · measured Jul 30");
  });

  it("a room with no headline quantities reads 'Not measured yet'", () => {
    expect(roomRowSummary(room({ quantities: [] }))).toBe("Not measured yet · measured Jul 30");
  });
});

describe("roomNeedsConfirm", () => {
  it("is true when any quantity is needs_confirm", () => {
    expect(
      roomNeedsConfirm([
        { kind: "walls_sqft", value: null, derivedValue: 562, status: "derived" },
        { kind: "baseboard_lnft", value: null, derivedValue: 88, status: "needs_confirm" },
      ]),
    ).toBe(true);
  });

  it("is false when every quantity is settled", () => {
    expect(roomNeedsConfirm(room().quantities)).toBe(false);
  });
});

describe("panelRows", () => {
  it("rooms first, then sites — the same order buildFromMeasurements seeds in", () => {
    const rows = panelRows([room()], [site()]);
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual(["room:Living Room", "site:Driveway"]);
  });

  it("room rows carry their capture id and confirm flag — the panel's door to the room card", () => {
    const rows = panelRows(
      [
        room({
          quantities: [
            { kind: "walls_sqft", value: null, derivedValue: 562, status: "needs_confirm" },
          ],
        }),
      ],
      [],
    );
    expect(rows[0]).toMatchObject({ kind: "room", captureId: "r1", needsConfirm: true });
  });
});

describe("seedKey", () => {
  it("is scoped per job and trims the capture name", () => {
    expect(seedKey("j1", " Driveway ")).toBe(seedKey("j1", "Driveway"));
    expect(seedKey("j1", "Driveway")).not.toBe(seedKey("j2", "Driveway"));
  });
});
