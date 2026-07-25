import { describe, it, expect, vi } from "vitest";
import { asUserId, FixedClock } from "@mallet/shared/types";
import type { UserId } from "@mallet/shared/types";
import type { TimeEntry } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { ApproveWeekUseCase, UNFINISHED_DAYS } from "./approve-week";

const ORG = "org-1";
const TECH: UserId = asUserId("11111111-1111-1111-1111-111111111111");
const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22"];
const NOW = new Date("2026-07-24T12:00:00.000Z");

// Approval is the shop's signature on a week AND the only trigger for hours leaving Mallet. An
// entry with no end time has no derivable duration: approving it means it is pushed to QuickBooks,
// rejected there as `entry_not_finished`, and the hours vanish with no error reaching anyone. So the
// whole week must be refused, naming the offending days.
const repo = (unfinished: string[], approveCount = 3) => {
  const approveWeek = vi.fn().mockResolvedValue(approveCount);
  const fake = {
    unfinishedDates: vi.fn().mockResolvedValue(unfinished),
    approveWeek,
  } as unknown as TimeEntryRepository;
  return { fake, approveWeek };
};

const run = (r: ReturnType<typeof repo>, bus?: { emit: ReturnType<typeof vi.fn> }) =>
  new ApproveWeekUseCase(
    r.fake,
    new FixedClock(NOW),
    bus as never,
  ).exec({ techUserId: TECH, dates: WEEK }, ORG);

describe("approving a week with unfinished hours", () => {
  it("refuses rather than approving the finished rows and leaving the rest", async () => {
    const r = repo(["2026-07-21"]);
    const res = await run(r);

    expect(res.ok).toBe(false);
    expect(r.approveWeek).not.toHaveBeenCalled();
  });

  it("names the offending days so the grid can point at them", async () => {
    const res = await run(repo(["2026-07-21", "2026-07-22"]));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toContain("2026-07-21");
      expect(res.error.message).toContain("2026-07-22");
    }
  });

  it("tags the refusal so the UI can branch on it, not string-match", async () => {
    const res = await run(repo(["2026-07-21"]));
    if (!res.ok && res.error.kind === "validation") {
      expect(res.error.field).toBe(UNFINISHED_DAYS);
    } else {
      expect.unreachable("expected a validation refusal");
    }
  });

  it("emits no approval event — nothing was approved, so nothing may reach QuickBooks", async () => {
    const bus = { emit: vi.fn() };
    await run(repo(["2026-07-21"]), bus);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

describe("approving a clean week", () => {
  it("approves and reports the count", async () => {
    const r = repo([], 5);
    const res = await run(r);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.approved).toBe(5);
    expect(r.approveWeek).toHaveBeenCalledWith(TECH, WEEK, NOW);
  });

  it("checks for unfinished days BEFORE writing anything", async () => {
    const r = repo([]);
    await run(r);
    // The read must precede the write; otherwise a refusal would come after the damage.
    const checkOrder = (r.fake.unfinishedDates as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0] as number;
    const writeOrder = r.approveWeek.mock.invocationCallOrder[0] as number;
    expect(checkOrder).toBeLessThan(writeOrder);
  });

  it("emits the approval event so the QuickBooks push can run", async () => {
    const bus = { emit: vi.fn() };
    await run(repo([], 2), bus);
    expect(bus.emit).toHaveBeenCalled();
  });

  it("does not emit when nothing actually changed — re-approving must not re-push", async () => {
    const bus = { emit: vi.fn() };
    await run(repo([], 0), bus);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});
