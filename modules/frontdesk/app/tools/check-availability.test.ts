import { describe, it, expect } from "vitest";
import { asOrgId, asUserId, FixedClock, type OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import { OrgSettings, type OrgSettingsProps } from "../../../settings/domain/org-settings";
import { baseSettingsProps } from "../../../settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../../domain/assistant";
import type { AvailabilityReader, AvailabilitySnapshot } from "../../domain/availability";
import type { BookedVisit } from "../slots";
import { checkAvailabilityTool, CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK } from "./check-availability";
import { inertSendNotification, inertGeocoder, fixedGeocoder } from "./test-support";
import type { Geocoder } from "../../domain/geocoder";
import type { VoiceToolContext, VoiceToolDeps } from "./tool-result";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  role: "office",
};

// Tuesday 2026-07-14 07:00 local (before the 8:00 open) — deterministic, matches slots.test.
const TUE_0700 = new Date(2026, 6, 14, 7, 0, 0);

const settingsFrom = (over: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const result = OrgSettings.create(baseSettingsProps({ orgId: ORG, ...over }));
  if (!result.ok) throw new Error(`settings fixture: ${result.error.message}`);
  return result.value;
};

const fakeSettings = (settings: OrgSettings | null): SettingsReader => ({
  async getByOrg() {
    return settings;
  },
});

const fakeAvailability = (snapshot: AvailabilitySnapshot): AvailabilityReader => ({
  async read() {
    return snapshot;
  },
  async readFieldCrewIds() {
    return [];
  },
  async readCrewSchedules() {
    return [];
  },
});

const buildCtx = (args: {
  settings: OrgSettings | null;
  snapshot: AvailabilitySnapshot;
  now?: Date;
  geocoder?: Geocoder;
}): VoiceToolContext => {
  const deps: VoiceToolDeps = {
    ensureCustomer: {} as never,
    createManualJob: {} as never,
    createVisit: {} as never,
    createTask: {} as never,
    settings: fakeSettings(args.settings),
    availability: fakeAvailability(args.snapshot),
    geocoder: args.geocoder ?? inertGeocoder(),
    sendNotification: inertSendNotification(),
    bus: { async emit() {} },
    clock: new FixedClock(args.now ?? TUE_0700),
    ids: { newId: () => "id-1" },
  };
  return { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps };
};

const bookedAt = (date: string, startHHMM: string): BookedVisit => ({ date, startHHMM, durationMinutes: 60 });

describe("checkAvailabilityTool", () => {
  it("exposes a JSON schema with lane + urgency required, service_city optional", () => {
    const params = checkAvailabilityTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    // Only lane + urgency are required — service_city is optional (the agent may not have the
    // caller's location yet at availability time, so requiring it would break the non-location flow).
    expect(params.required).toEqual(["lane", "urgency"]);
    // preferred_day was dropped (parsed but never used — dead model-trust surface); service_city is
    // the optional early out-of-area field.
    expect(Object.keys(params.properties).sort()).toEqual(["lane", "service_city", "urgency"]);
  });

  it("offers three DISCRETE start times as a pick-one close, with bounds in data.slots", async () => {
    // A single open day with exactly three windows (Sat 8–14 → 8, 10, 12) so the spread offers all
    // three, earliest-first, and the speak reads them as discrete start times.
    const satOnly = settingsFrom({
      hoursWdOpen: 0,
      hoursWdClose: 0,
      hoursSatOpen: 8,
      hoursSatClose: 14,
      hoursSunOpen: 0,
      hoursSunClose: 0,
    });
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0); // Saturday
    const ctx = buildCtx({ settings: satOnly, snapshot: { crewCount: 1, visits: [] }, now: sat0700 });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);

    // discrete start times, noon worded — not consecutive ranges.
    expect(result.speak).toBe(
      "I can come today at 8am, today at 10am, or today at noon — which works?",
    );
    const slots = result.data?.slots as Array<{
      date: string;
      startHHMM: string;
      endHHMM: string;
      speakable: string;
    }>;
    expect(slots).toHaveLength(3);
    // startHHMM + endHHMM (start + 2h) are still carried for book_visit / the arrival span.
    expect(slots[0]).toMatchObject({ date: "2026-07-18", startHHMM: "08:00", endHHMM: "10:00" });
    expect(slots[1]).toMatchObject({ startHHMM: "10:00", endHHMM: "12:00" });
    expect(slots[2]).toMatchObject({ startHHMM: "12:00", endHHMM: "14:00" });
    // speakable is a discrete start time, not a range.
    expect(slots[0]!.speakable).toBe("today at 8am");
    expect(slots[2]!.speakable).toBe("today at noon");
    // no morning/afternoon field survives
    expect(slots[0]).not.toHaveProperty("window");
  });

  it("SPREADS three start times across many available windows (first / middle / last)", async () => {
    // Default hours wd 8–17 (→ 8,10,12,14 per weekday), Tue 07:00, lookahead 5 → 16 windows across
    // Tue–Fri. The spread samples index 0, 8, 15 → Tue 08:00, Thu 08:00, Fri 14:00 — genuinely
    // different times, not the first three consecutive morning windows.
    const ctx = buildCtx({ settings: settingsFrom(), snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    const slots = result.data?.slots as Array<{ date: string; startHHMM: string }>;
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "08:00" }); // soonest first
    expect(slots[1]).toMatchObject({ date: "2026-07-16", startHHMM: "08:00" }); // middle
    expect(slots[2]).toMatchObject({ date: "2026-07-17", startHHMM: "14:00" }); // last
    // the offered start times are genuinely distinct
    const keys = slots.map((s) => `${s.date} ${s.startHHMM}`);
    expect(new Set(keys).size).toBe(3);
  });

  it("speaks a two-start either/or when exactly two are available in the lookahead", async () => {
    // Saturday-only shop with Sat hours 8–12 (two windows) and no bookings → exactly two.
    const satOnly = settingsFrom({
      hoursWdOpen: 0,
      hoursWdClose: 0,
      hoursSatOpen: 8,
      hoursSatClose: 12,
      hoursSunOpen: 0,
      hoursSunClose: 0,
    });
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0); // Saturday
    const ctx = buildCtx({ settings: satOnly, snapshot: { crewCount: 1, visits: [] }, now: sat0700 });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect(result.speak).toBe("I can come today at 8am or today at 10am — which works?");
    expect(result.data?.slots).toHaveLength(2);
  });

  it("offers exactly one start time + backstop when the lookahead yields a single window", async () => {
    // Saturday-only shop, first Saturday window booked → only 10-12 remains inside lookahead.
    const satOnly = settingsFrom({
      hoursWdOpen: 0,
      hoursWdClose: 0,
      hoursSatOpen: 8,
      hoursSatClose: 12,
      hoursSunOpen: 0,
      hoursSunClose: 0,
    });
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const ctx = buildCtx({
      settings: satOnly,
      snapshot: { crewCount: 1, visits: [bookedAt("2026-07-18", "08:00")] },
      now: sat0700,
    });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect(result.speak).toBe(
      "I can come today at 10am — or the office can call you with more times.",
    );
    expect(result.data?.slots).toHaveLength(1);
  });

  it("falls back to the take-message framing when there is no opening", async () => {
    const closed = settingsFrom({
      hoursWdOpen: 0,
      hoursWdClose: 0,
      hoursSatOpen: 0,
      hoursSatClose: 0,
      hoursSunOpen: 0,
      hoursSunClose: 0,
    });
    const ctx = buildCtx({ settings: closed, snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);

    expect(result.speak).toContain("take a message");
    expect(result.data?.slots).toEqual([]);
  });

  it("passes emergency=true so today's soonest window is offered even when the day has closed", async () => {
    const tue1800 = new Date(2026, 6, 14, 18, 0, 0); // past the 17:00 close
    const ctx = buildCtx({
      settings: settingsFrom(),
      snapshot: { crewCount: 1, visits: [] },
      now: tue1800,
    });
    const emergency = await checkAvailabilityTool.handle({ lane: "repair", urgency: "emergency" }, ctx);
    const slots = emergency.data?.slots as Array<{ date: string }>;
    expect(slots[0]!.date).toBe("2026-07-14"); // today still surfaced on emergency

    const normal = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    const normalSlots = normal.data?.slots as Array<{ date: string }>;
    expect(normalSlots[0]!.date).toBe("2026-07-15"); // normal rolls to tomorrow
  });

  it("treats a roster with no field crew as one working technician", async () => {
    // crewCount 0 from the reader — the tool clamps to MIN_CREW so it still offers slots.
    const ctx = buildCtx({ settings: settingsFrom(), snapshot: { crewCount: 0, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect((result.data?.slots as unknown[]).length).toBeGreaterThan(0);
  });

  it("falls back to message framing when the org has no settings", async () => {
    const ctx = buildCtx({ settings: null, snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect(result.speak).toContain("take a message");
    expect(result.data?.slots).toEqual([]);
  });

  // ── service-area early bail (optional service_city) ──
  // Origin ≈ Pleasanton (37.66, -121.87), radius 25 mi in the fixture. A geocoder pinned to Fresno
  // (36.74, -119.77 — ~120 mi east) is confidently OUT → decline before offering any slot.
  const OUT_OF_AREA_POINT = { lat: 36.74, lng: -119.77 };
  const nearOrigin = { originLat: 37.66, originLng: -121.87, serviceOriginAddress: "Pleasanton" };

  it("service_city out-of-area: declines with the out-of-area line and offers NO slots", async () => {
    const ctx = buildCtx({
      settings: settingsFrom(nearOrigin),
      snapshot: { crewCount: 1, visits: [] },
      geocoder: fixedGeocoder(OUT_OF_AREA_POINT),
    });
    const result = await checkAvailabilityTool.handle(
      { lane: "repair", urgency: "normal", service_city: "Fresno" },
      ctx,
    );
    expect(result.speak).toBe(CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK);
    expect(result.data?.slots).toEqual([]);
  });

  it("WITHOUT service_city: offers slots as today even with a far-away geocoder (no early check)", async () => {
    // The far geocoder would place ANY address out of area — but with no service_city the early check
    // never runs, so the normal slot offer proceeds unchanged.
    const ctx = buildCtx({
      settings: settingsFrom(nearOrigin),
      snapshot: { crewCount: 1, visits: [] },
      geocoder: fixedGeocoder(OUT_OF_AREA_POINT),
    });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect(result.speak).not.toBe(CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK);
    expect((result.data?.slots as unknown[]).length).toBeGreaterThan(0);
  });

  it("service_city IN area: offers slots normally (in-radius geocode falls through)", async () => {
    const ctx = buildCtx({
      settings: settingsFrom(nearOrigin),
      snapshot: { crewCount: 1, visits: [] },
      geocoder: fixedGeocoder({ lat: 37.68, lng: -121.9 }), // ~2 mi from origin → "in"
    });
    const result = await checkAvailabilityTool.handle(
      { lane: "repair", urgency: "normal", service_city: "Pleasanton" },
      ctx,
    );
    expect(result.speak).not.toBe(CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK);
    expect((result.data?.slots as unknown[]).length).toBeGreaterThan(0);
  });

  it("service_city with no origin configured: degrades to a normal offer (unknown → book)", async () => {
    // Default fixture has null origin → the check is "unknown" regardless of the geocoder → slots.
    const ctx = buildCtx({
      settings: settingsFrom(),
      snapshot: { crewCount: 1, visits: [] },
      geocoder: fixedGeocoder(OUT_OF_AREA_POINT),
    });
    const result = await checkAvailabilityTool.handle(
      { lane: "repair", urgency: "normal", service_city: "Fresno" },
      ctx,
    );
    expect(result.speak).not.toBe(CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK);
    expect((result.data?.slots as unknown[]).length).toBeGreaterThan(0);
  });
});
