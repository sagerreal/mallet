import { describe, it, expect } from "vitest";
import { pickOnCall, type OnCallCandidate } from "./on-call";

const ORG = { openHour: 8, closeHour: 17 };
const person = (over: Partial<OnCallCandidate> = {}): OnCallCandidate => ({
  userId: "u1",
  name: "Sarah",
  phone: "+17815550101",
  todayHours: null,
  ...over,
});

describe("pickOnCall", () => {
  it("picks someone who is on shift", () => {
    const r = pickOnCall({ candidates: [person()], orgHours: ORG, hourNow: 10 });
    expect(r?.name).toBe("Sarah");
  });

  it("returns null outside everyone's hours rather than ringing somebody at home", () => {
    // Null is a real answer — the caller falls back to the org's emergency number.
    expect(pickOnCall({ candidates: [person()], orgHours: ORG, hourNow: 22 })).toBeNull();
  });

  it("uses a person's OWN hours over the org's", () => {
    // Mike works evenings. At 7pm the shop is shut but he is on.
    const mike = person({ userId: "u2", name: "Mike", todayHours: { openHour: 14, closeHour: 22 } });
    expect(pickOnCall({ candidates: [mike], orgHours: ORG, hourNow: 19 })?.name).toBe("Mike");
    // ...and at 9am he is not, even though the shop is open.
    expect(pickOnCall({ candidates: [mike], orgHours: ORG, hourNow: 9 })).toBeNull();
  });

  it("falls back to org hours for anyone with no schedule of their own", () => {
    // Most staff have no crew_schedules rows. Treating that as "unavailable" would make turning
    // this on silently disable escalation for the whole shop.
    expect(pickOnCall({ candidates: [person({ todayHours: null })], orgHours: ORG, hourNow: 10 })).not.toBeNull();
  });

  it("treats open === close === 0 as CLOSED, not as a full day", () => {
    // That pair is the schema's closed-day sentinel; read literally it would mean midnight-to-
    // midnight and put a caller through at 3am on a day nobody works.
    const off = person({ todayHours: { openHour: 0, closeHour: 0 } });
    expect(pickOnCall({ candidates: [off], orgHours: ORG, hourNow: 10 })).toBeNull();
  });

  it("returns null when the ORG is closed and nobody overrides it", () => {
    expect(pickOnCall({ candidates: [person()], orgHours: { openHour: 0, closeHour: 0 }, hourNow: 10 })).toBeNull();
  });

  it("is exclusive at the closing hour", () => {
    // 17:00 with a 17:00 close is after work, not the last minute of it.
    expect(pickOnCall({ candidates: [person()], orgHours: ORG, hourNow: 17 })).toBeNull();
    expect(pickOnCall({ candidates: [person()], orgHours: ORG, hourNow: 16 })).not.toBeNull();
  });

  it("breaks ties deterministically so a retry reaches the same person", () => {
    const zoe = person({ userId: "u9", name: "Zoe" });
    const abe = person({ userId: "u2", name: "Abe" });
    expect(pickOnCall({ candidates: [zoe, abe], orgHours: ORG, hourNow: 10 })?.name).toBe("Abe");
    expect(pickOnCall({ candidates: [abe, zoe], orgHours: ORG, hourNow: 10 })?.name).toBe("Abe");
  });

  it("returns null when nobody takes calls at all", () => {
    expect(pickOnCall({ candidates: [], orgHours: ORG, hourNow: 10 })).toBeNull();
  });
});
