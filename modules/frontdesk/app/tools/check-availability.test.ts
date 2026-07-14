import { describe, it, expect } from "vitest";
import { asOrgId, asUserId, FixedClock, type OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import { OrgSettings, type OrgSettingsProps } from "../../../settings/domain/org-settings";
import { baseSettingsProps } from "../../../settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../../domain/assistant";
import type { AvailabilityReader, AvailabilitySnapshot } from "../../domain/availability";
import type { BookedVisit } from "../slots";
import { checkAvailabilityTool } from "./check-availability";
import { inertNotificationSender } from "./test-support";
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
    notificationSender: inertNotificationSender(),
    bus: { async emit() {} },
    clock: new FixedClock(args.now ?? TUE_0700),
    ids: { newId: () => "id-1" },
  };
  return { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps };
};

const bookedMorning = (date: string): BookedVisit => ({ date, startHHMM: "09:00", durationMinutes: 60 });

describe("checkAvailabilityTool", () => {
  it("exposes a JSON schema with lane + urgency required", () => {
    const params = checkAvailabilityTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toEqual(["lane", "urgency"]);
    expect(Object.keys(params.properties).sort()).toEqual(["lane", "preferred_day", "urgency"]);
  });

  it("offers two slots as an either/or close", async () => {
    const ctx = buildCtx({ settings: settingsFrom(), snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);

    expect(result.speak).toBe("I've got today 8 to 12 or today afternoon, 1 to 5 — which works?");
    const slots = result.data?.slots as Array<{ date: string; window: string; startHHMM: string }>;
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "morning", startHHMM: "08:00" });
  });

  it("offers exactly one slot + backstop when the lookahead yields a single window", async () => {
    // crewCount 1, weekday, morning booked, lookahead effectively today-only via a closed rest-of-week.
    const closedExceptToday = settingsFrom({
      hoursWdOpen: 8,
      hoursWdClose: 17,
      hoursSatOpen: 0,
      hoursSatClose: 0,
      hoursSunOpen: 0,
      hoursSunClose: 0,
    });
    // Book Tue morning; Wed–Fri also fully booked so only Tue afternoon remains inside lookahead.
    const visits: BookedVisit[] = [
      bookedMorning("2026-07-14"),
      bookedMorning("2026-07-15"),
      { date: "2026-07-15", startHHMM: "14:00", durationMinutes: 60 },
      bookedMorning("2026-07-16"),
      { date: "2026-07-16", startHHMM: "14:00", durationMinutes: 60 },
      bookedMorning("2026-07-17"),
      { date: "2026-07-17", startHHMM: "14:00", durationMinutes: 60 },
      // 2026-07-18 is Saturday (closed above), 2026-07-19 Sunday (closed) — lookahead 5 ends 07-19.
    ];
    const ctx = buildCtx({ settings: closedExceptToday, snapshot: { crewCount: 1, visits } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);

    expect(result.speak).toBe(
      "I've got today afternoon, 1 to 5 — or the office can call you with more times.",
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

  it("passes emergency=true so today is offered even when the day has closed", async () => {
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
    expect(result.data?.slots).toHaveLength(2);
  });

  it("falls back to message framing when the org has no settings", async () => {
    const ctx = buildCtx({ settings: null, snapshot: { crewCount: 1, visits: [] } });
    const result = await checkAvailabilityTool.handle({ lane: "repair", urgency: "normal" }, ctx);
    expect(result.speak).toContain("take a message");
    expect(result.data?.slots).toEqual([]);
  });
});
