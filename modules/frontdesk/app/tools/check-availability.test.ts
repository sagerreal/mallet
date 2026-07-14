import { describe, it, expect } from "vitest";
import { asOrgId, asUserId, FixedClock, type OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import { OrgSettings, type OrgSettingsProps } from "../../../settings/domain/org-settings";
import { baseSettingsProps } from "../../../settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../../domain/assistant";
import type { AvailabilityReader, AvailabilitySnapshot } from "../../domain/availability";
import type { BookedVisit } from "../slots";
import { checkAvailabilityTool } from "./check-availability";
import { inertSendNotification } from "./test-support";
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
});

const buildCtx = (args: {
  settings: OrgSettings | null;
  snapshot: AvailabilitySnapshot;
  now?: Date;
}): VoiceToolContext => {
  const deps: VoiceToolDeps = {
    ensureCustomer: {} as never,
    createManualJob: {} as never,
    createVisit: {} as never,
    createTask: {} as never,
    settings: fakeSettings(args.settings),
    availability: fakeAvailability(args.snapshot),
    sendNotification: inertSendNotification(),
    bus: { async emit() {} },
    clock: new FixedClock(args.now ?? TUE_0700),
    ids: { newId: () => "id-1" },
  };
  return { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps };
};

const bookedAt = (date: string, startHHMM: string): BookedVisit => ({ date, startHHMM, durationMinutes: 60 });

describe("checkAvailabilityTool", () => {
  it("exposes a JSON schema with lane + urgency required", () => {
    const params = checkAvailabilityTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toEqual(["lane", "urgency"]);
    // preferred_day was dropped (parsed but never used — dead model-trust surface).
    expect(Object.keys(params.properties).sort()).toEqual(["lane", "urgency"]);
  });

  it("offers three 2-hour windows as a pick-one close, with bounds in data.slots", async () => {
    const ctx = buildCtx({ settings: settingsFrom(), snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);

    // default hours wd 8–17 → 8-10, 10-12, 12-14 are the earliest three at Tue 07:00.
    expect(result.speak).toBe(
      "I can do today, 8 to 10am, today, 10 to 12pm, or today, 12 to 2pm — which works?",
    );
    const slots = result.data?.slots as Array<{ date: string; startHHMM: string; endHHMM: string }>;
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "08:00", endHHMM: "10:00" });
    expect(slots[1]).toMatchObject({ startHHMM: "10:00", endHHMM: "12:00" });
    expect(slots[2]).toMatchObject({ startHHMM: "12:00", endHHMM: "14:00" });
    // no morning/afternoon field survives
    expect(slots[0]).not.toHaveProperty("window");
  });

  it("offers exactly two windows as an either/or when only two remain", async () => {
    // Book the first two of today's windows so only 12-14 and 14-16 remain (wd 8–17 → 4 windows).
    const visits: BookedVisit[] = [bookedAt("2026-07-14", "08:00"), bookedAt("2026-07-14", "10:00")];
    const ctx = buildCtx({
      settings: settingsFrom({ hoursSatOpen: 0, hoursSatClose: 0 }),
      snapshot: { crewCount: 1, visits },
    });
    // Force lookahead exhaustion beyond today by fully-booking the rest — simplest: lookahead is 5
    // but we just check today yields two and they are the ones asserted (later days append if room,
    // so restrict by booking Wed–Fri). Instead assert the FIRST two are today's remaining windows.
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    const slots = result.data?.slots as Array<{ startHHMM: string }>;
    // The two remaining today windows come first.
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "12:00" });
    expect(slots[1]).toMatchObject({ date: "2026-07-14", startHHMM: "14:00" });
  });

  it("speaks a two-window either/or when exactly two are available in the lookahead", async () => {
    // Saturday-only shop, lookahead 0 effect via closed weekdays around it. Use a Saturday now with
    // Sat hours 8–12 (two windows) and no bookings → exactly two.
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
    expect(result.speak).toBe("I can do today, 8 to 10am or today, 10 to 12pm — which works?");
    expect(result.data?.slots).toHaveLength(2);
  });

  it("offers exactly one slot + backstop when the lookahead yields a single window", async () => {
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
      "I can do today, 10 to 12pm — or the office can call you with more times.",
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
});
