import { describe, it, expect } from "vitest";
import { asOrgId, asUserId, isOk } from "@mallet/shared/types";
import { WeekSubmission, weekStartOf, type WeekSubmissionProps } from "./week-submission";

const base = (over: Partial<WeekSubmissionProps> = {}): WeekSubmissionProps => ({
  id: "11111111-1111-1111-1111-111111111111",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  techUserId: asUserId("33333333-3333-3333-3333-333333333333"),
  weekStart: "2026-08-10", // a Monday
  submittedAt: new Date("2026-08-14T20:00:00Z"),
  reopenedAt: null,
  reopenReason: null,
  createdAt: new Date("2026-08-14T20:00:00Z"),
  updatedAt: new Date("2026-08-14T20:00:00Z"),
  ...over,
});

const unwrap = (r: ReturnType<typeof WeekSubmission.create>): WeekSubmission => {
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("WeekSubmission", () => {
  it("accepts a Monday week start", () => {
    expect(isOk(WeekSubmission.create(base()))).toBe(true);
  });

  it("refuses a mid-week start — one attestation stream per week, never two overlapping", () => {
    expect(WeekSubmission.create(base({ weekStart: "2026-08-12" })).ok).toBe(false);
    expect(WeekSubmission.create(base({ weekStart: "not-a-date" })).ok).toBe(false);
  });

  it("stands until reopened, and a reopen carries its reason", () => {
    const now = new Date("2026-08-15T09:00:00Z");
    const sub = unwrap(WeekSubmission.create(base()));
    expect(sub.isActive()).toBe(true);
    const reopened = sub.reopen("new hours landed after you submitted", now);
    expect(reopened.isActive()).toBe(false);
    expect(reopened.props.reopenReason).toBe("new hours landed after you submitted");
    // Immutability: the original is untouched.
    expect(sub.isActive()).toBe(true);
  });

  it("resubmitting after a reopen makes the same row the standing attestation again", () => {
    const sub = unwrap(WeekSubmission.create(base())).reopen("late clock-in", new Date());
    const again = sub.resubmit(new Date("2026-08-16T08:00:00Z"));
    expect(again.isActive()).toBe(true);
    expect(again.props.reopenedAt).toBeNull();
    expect(again.props.reopenReason).toBeNull();
    expect(again.props.submittedAt.toISOString()).toBe("2026-08-16T08:00:00.000Z");
  });
});

describe("weekStartOf", () => {
  it("maps any date to its Monday", () => {
    expect(weekStartOf("2026-08-10")).toBe("2026-08-10"); // Monday itself
    expect(weekStartOf("2026-08-12")).toBe("2026-08-10"); // Wednesday
    expect(weekStartOf("2026-08-16")).toBe("2026-08-10"); // Sunday belongs to the week it ends
  });
});
