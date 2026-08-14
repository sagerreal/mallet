import { describe, it, expect } from "vitest";
import { planCarve, toHHMM, type CarveHost } from "./carve";

const regular = (over: Partial<CarveHost> = {}): CarveHost => ({
  id: "r1",
  kind: "shop",
  startTime: "10:00",
  endTime: "22:00",
  ...over,
});

/** Minutes a plan leaves behind for the host, so the paid-time invariant can be asserted. */
const hostMinutes = (plan: ReturnType<typeof planCarve>, host: CarveHost): number => {
  const m = (t: string) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  if (plan.action === "replace") return 0;
  if (plan.action === "trim") return m(plan.endTime ?? "00:00") - m(plan.startTime);
  if (plan.action === "split") {
    return m(plan.hostEndTime) - m(host.startTime) + (m(plan.tailEndTime ?? "00:00") - m(plan.tailStartTime));
  }
  return m(host.endTime ?? "00:00") - m(host.startTime);
};

describe("planCarve — the paid-time invariant", () => {
  it("splitting the middle keeps the day's paid minutes exactly", () => {
    // 12h regular, carve 3h of job out of the middle → 3h + 6h regular left. 9 + 3 = 12.
    const host = regular();
    const plan = planCarve({ startTime: "13:00", endTime: "16:00" }, [host]);
    expect(plan.action).toBe("split");
    expect(hostMinutes(plan, host)).toBe(12 * 60 - 3 * 60);
  });

  it("trimming the front keeps them too", () => {
    const host = regular();
    const plan = planCarve({ startTime: "10:00", endTime: "13:00" }, [host]);
    expect(plan.action).toBe("trim");
    expect(hostMinutes(plan, host)).toBe(12 * 60 - 3 * 60);
  });

  it("trimming the back keeps them too", () => {
    const host = regular();
    const plan = planCarve({ startTime: "19:00", endTime: "22:00" }, [host]);
    expect(plan.action).toBe("trim");
    expect(hostMinutes(plan, host)).toBe(12 * 60 - 3 * 60);
  });

  it("covering the host exactly leaves it nothing, so it goes", () => {
    const host = regular();
    const plan = planCarve({ startTime: "10:00", endTime: "22:00" }, [host]);
    expect(plan).toEqual({ action: "replace", hostId: "r1" });
    expect(hostMinutes(plan, host)).toBe(0);
  });
});

describe("planCarve — the shape of a split", () => {
  it("cuts the host at the new row's start and re-opens it at the end", () => {
    expect(planCarve({ startTime: "13:00", endTime: "16:00" }, [regular()])).toEqual({
      action: "split",
      hostId: "r1",
      hostEndTime: "13:00",
      tailStartTime: "16:00",
      tailEndTime: "22:00",
    });
  });

  it("moves only the front edge when the new row starts flush", () => {
    expect(planCarve({ startTime: "10:00", endTime: "13:00" }, [regular()])).toEqual({
      action: "trim",
      hostId: "r1",
      startTime: "13:00",
      endTime: "22:00",
    });
  });
});

describe("planCarve — what it refuses", () => {
  it("refuses to carve a BREAK — that would turn unpaid minutes into paid ones", () => {
    const plan = planCarve({ startTime: "12:10", endTime: "12:20" }, [
      regular({ id: "b1", kind: "break", startTime: "12:00", endTime: "12:30" }),
    ]);
    expect(plan).toEqual({ action: "refuse", reason: "not-regular" });
  });

  it("refuses to carve TRAVEL or another JOB — both already claim that cost", () => {
    for (const kind of ["travel", "job"]) {
      expect(planCarve({ startTime: "13:00", endTime: "14:00" }, [regular({ kind })])).toEqual({
        action: "refuse",
        reason: "not-regular",
      });
    }
  });

  it("refuses a running host — there is no end to cut against", () => {
    // Guessing a finish time would write one nobody recorded.
    expect(planCarve({ startTime: "13:00", endTime: "14:00" }, [regular({ endTime: null })])).toEqual({
      action: "refuse",
      reason: "open-ended",
    });
  });

  it("refuses when the new row straddles two rows", () => {
    const plan = planCarve({ startTime: "11:30", endTime: "13:30" }, [
      regular({ id: "a", startTime: "10:00", endTime: "12:00" }),
      regular({ id: "b", startTime: "13:00", endTime: "15:00" }),
    ]);
    expect(plan).toEqual({ action: "refuse", reason: "spans-rows" });
  });

  it("refuses when the new row sticks out past the host", () => {
    // Those extra minutes are ones nobody clocked at all.
    expect(planCarve({ startTime: "09:00", endTime: "13:00" }, [regular()])).toEqual({
      action: "refuse",
      reason: "spans-rows",
    });
  });
});

describe("planCarve — when there is nothing to carve", () => {
  it("does nothing on an empty day", () => {
    expect(planCarve({ startTime: "13:00", endTime: "16:00" }, [])).toEqual({ action: "none" });
  });

  it("does nothing when the new row lands in a gap", () => {
    const plan = planCarve({ startTime: "13:00", endTime: "14:00" }, [
      regular({ startTime: "08:00", endTime: "12:00" }),
    ]);
    expect(plan).toEqual({ action: "none" });
  });

  it("does nothing for a row with no end — the caller's own gate handles those", () => {
    expect(planCarve({ startTime: "13:00", endTime: null }, [regular()])).toEqual({ action: "none" });
  });

  it("touching only at the boundary is not an overlap", () => {
    // 12:00–13:00 against a host ending at 12:00 shares no minute.
    const plan = planCarve({ startTime: "12:00", endTime: "13:00" }, [
      regular({ startTime: "08:00", endTime: "12:00" }),
    ]);
    expect(plan).toEqual({ action: "none" });
  });
});

describe("toHHMM", () => {
  it("pads both parts", () => {
    expect(toHHMM(9 * 60 + 5)).toBe("09:05");
    expect(toHHMM(13 * 60)).toBe("13:00");
    expect(toHHMM(0)).toBe("00:00");
  });
});
