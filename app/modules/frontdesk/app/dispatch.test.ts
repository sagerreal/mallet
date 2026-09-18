// Unit tests for the pure chooseCrew dispatch logic. Import DIRECTLY from the implementation file
// and domain types — not the frontdesk barrel (the barrel pulls in the API router which needs DB env
// vars and will throw in a hermetic test run).
import { describe, it, expect } from "vitest";
import { chooseCrew } from "./dispatch";
import type { CrewLoad, ChooseCrewInput } from "./dispatch";
import type { GeoPoint } from "../domain/geocoder";

// ── Real Bay Area coordinates (decimal degrees, WGS84) ────────────────────────
// Two points a known, meaningful distance apart so the proximity assertion is not
// vacuously passing on magic-number distances.
//
// SFO (San Francisco International) ≈ (37.6213, -122.3790)
// OAK (Oakland International)       ≈ (37.7213, -122.2208)
// haversineMiles(SFO, OAK) ≈ 11.9 mi — well separated for test clarity.
//
// San Jose downtown                  ≈ (37.3382, -121.8863)
// haversineMiles(SFO, SJC) ≈ 31.8 mi — even farther, used as "far" anchor.

const SFO: GeoPoint = { lat: 37.6213, lng: -122.379 };
const OAK: GeoPoint = { lat: 37.7213, lng: -122.2208 };
const SJC: GeoPoint = { lat: 37.3382, lng: -121.8863 };

// ── Helpers ────────────────────────────────────────────────────────────────────
// Small factory so tests stay concise; reads as prose.
const crew = (userId: string, points: (GeoPoint | null)[]): CrewLoad => ({
  userId: userId as CrewLoad["userId"],
  skillTags: [],
  sameDayJobs: points.map((point) => ({ point })),
});

const input = (candidates: CrewLoad[], jobPoint: GeoPoint | null): ChooseCrewInput => ({
  candidates,
  jobPoint,
});

// ── Test cases ─────────────────────────────────────────────────────────────────

describe("chooseCrew", () => {
  // ── No candidates ────────────────────────────────────────────────────────────

  it("returns null when there are no candidates", () => {
    expect(chooseCrew(input([], null))).toBeNull();
    expect(chooseCrew(input([], SFO))).toBeNull();
  });

  // ── Single candidate ─────────────────────────────────────────────────────────

  it("returns the only candidate regardless of jobPoint or job count", () => {
    expect(chooseCrew(input([crew("alice", [])], null))).toBe("alice");
    expect(chooseCrew(input([crew("bob", [SFO])], SJC))).toBe("bob");
    expect(chooseCrew(input([crew("carol", [null])], SFO))).toBe("carol");
  });

  // ── Fewer same-day jobs wins (load-based selection) ──────────────────────────

  it("returns the crew with fewer same-day jobs, regardless of jobPoint", () => {
    // A has 2 jobs, B has 1 → B wins regardless of proximity
    const a = crew("a", [SFO, OAK]);
    const b = crew("b", [SJC]);
    expect(chooseCrew(input([a, b], null))).toBe("b");
    expect(chooseCrew(input([a, b], SFO))).toBe("b");
    // Order doesn't matter — load beats everything else
    expect(chooseCrew(input([b, a], SFO))).toBe("b");
  });

  it("returns the crew with zero jobs when others have one or more", () => {
    const idle = crew("idle", []);
    const busy = crew("busy", [SFO]);
    expect(chooseCrew(input([busy, idle], SFO))).toBe("idle");
    expect(chooseCrew(input([idle, busy], SFO))).toBe("idle");
  });

  // ── Tie broken by proximity ──────────────────────────────────────────────────

  it("tie: returns the crew whose same-day job is nearest to jobPoint", () => {
    // Both have 1 same-day job (equal load). A's job is at SFO, B's is at SJC.
    // jobPoint = OAK; OAK is ~12 mi from SFO but ~65 mi from SJC → A wins.
    const a = crew("a", [SFO]);
    const b = crew("b", [SJC]);
    expect(chooseCrew(input([a, b], OAK))).toBe("a");
  });

  it("tie: flipping proximity reverses the winner", () => {
    // jobPoint = SJC; SFO is farther from SJC than OAK is → B wins.
    const a = crew("a", [SFO]);
    const b = crew("b", [OAK]);
    expect(chooseCrew(input([a, b], SJC))).toBe("b");
  });

  it("tie: multiple same-day jobs — uses the MINIMUM distance across all a crew's jobs", () => {
    // Both have 2 same-day jobs (equal load). A has [SJC, OAK], B has [SFO, SJC].
    // jobPoint = OAK.
    // A's min dist: min(haversine(SJC,OAK), haversine(OAK,OAK)) = 0  → A should win.
    // (If the implementation erroneously picks max or average, B might win — this locks min.)
    const a = crew("a", [SJC, OAK]);
    const b = crew("b", [SFO, SJC]);
    expect(chooseCrew(input([a, b], OAK))).toBe("a");
  });

  // ── Tie with no jobPoint (stable-first wins) ─────────────────────────────────

  it("tie with null jobPoint: returns the first candidate in stable order", () => {
    const a = crew("a", [SFO]);
    const b = crew("b", [OAK]);
    expect(chooseCrew(input([a, b], null))).toBe("a");
    expect(chooseCrew(input([b, a], null))).toBe("b");
  });

  // ── jobPoint present but all jobs have null points → stable-first ────────────

  it("tie with jobPoint: all candidates have null-point jobs → stable-first fallback", () => {
    // Both have 1 same-day job but neither has a geocoded point. Distance is Infinity for both
    // → stable-first wins even though jobPoint is present.
    const a = crew("a", [null]);
    const b = crew("b", [null]);
    expect(chooseCrew(input([a, b], SFO))).toBe("a");
    expect(chooseCrew(input([b, a], SFO))).toBe("b");
  });

  it("tie: one crew has a null-point job, the other has a real point → real-point crew wins", () => {
    // A's job has no geocode (distance Infinity), B's job is near jobPoint → B wins.
    const a = crew("a", [null]);
    const b = crew("b", [SFO]);
    expect(chooseCrew(input([a, b], SFO))).toBe("b");
  });

  // ── Zero-load tie (all crews have zero same-day jobs) ────────────────────────

  it("zero-load tie with jobPoint present: stable-first wins (no jobs to measure from)", () => {
    // Every crew has 0 same-day jobs → all distances are Infinity → stable-first.
    const a = crew("a", []);
    const b = crew("b", []);
    expect(chooseCrew(input([a, b], SFO))).toBe("a");
    expect(chooseCrew(input([b, a], OAK))).toBe("b");
  });

  it("zero-load tie with null jobPoint: stable-first wins", () => {
    const a = crew("a", []);
    const b = crew("b", []);
    expect(chooseCrew(input([a, b], null))).toBe("a");
  });

  // ── Three-way tie, mixed geocodes ────────────────────────────────────────────

  it("three-way tie: picks the crew nearest to jobPoint, stable-first on equal distance", () => {
    // All have 1 same-day job. jobPoint = OAK.
    // A → SJC (far), B → SFO (near OAK, ~12 mi), C → SJC (far, same as A).
    // B has shortest distance → B wins.
    const a = crew("a", [SJC]);
    const b = crew("b", [SFO]);
    const c = crew("c", [SJC]);
    expect(chooseCrew(input([a, b, c], OAK))).toBe("b");
  });

  it("three-way tie: stable-first breaks exact distance tie among two crews", () => {
    // All have 1 same-day job. jobPoint = OAK.
    // A → SFO (~12 mi), B → SFO (~12 mi, identical point), C → SJC (far).
    // A and B tie on distance → stable-first → A wins.
    const a = crew("a", [SFO]);
    const b = crew("b", [SFO]);
    const c = crew("c", [SJC]);
    expect(chooseCrew(input([a, b, c], OAK))).toBe("a");
  });
});
