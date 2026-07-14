import { describe, it, expect } from "vitest";
import { validation, err, type AppError, type Result } from "@mallet/shared/types";
import { CreateManualJobUseCase } from "../../../jobs/app/create-manual-job";
import { CreateVisitUseCase } from "../../../jobs/app/create-visit";
import { bookVisitTool, BOOK_VISIT_ERROR_SPEAK } from "./book-visit";
import { deriveDisposition } from "../disposition";
import { buildHarness, onlyJob, settingsFrom, REPAIR_INPUT, LEAD_UUID } from "./book-visit.harness";

// The expected-failure + edge paths of book_visit. Every failure returns the SPOKEN FALLBACK with
// NO data.kind (so it never dispositions as booked_job — see disposition.test.ts) and files an
// office follow-up task so the caller is never dropped. It NEVER throws and NEVER sends a
// confirmation SMS (the booking didn't complete).

const errManualJob = (): CreateManualJobUseCase =>
  ({
    async exec(): Promise<Result<never, AppError>> {
      return err(validation("job failed", "svc"));
    },
  }) as unknown as CreateManualJobUseCase;

const errVisit = (message: string): CreateVisitUseCase =>
  ({
    async exec(): Promise<Result<never, AppError>> {
      return err(validation(message, "durationMinutes"));
    },
  }) as unknown as CreateVisitUseCase;

describe("bookVisitTool — failure + edge paths", () => {
  it("job create err: spoken fallback, no throw, no visit", async () => {
    const h = buildHarness({ createManualJob: errManualJob() });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    // a message task is filed so the office locks in the time
    expect(h.tasks.created.length).toBeGreaterThanOrEqual(1);
  });

  it("no settings for the org: spoken fallback, no throw", async () => {
    const h = buildHarness({ settings: null });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h.jobs.jobs.size).toBe(0);
  });

  it("failed booking result carries NO data.kind, so it is NOT dispositioned as booked_job", async () => {
    const h = buildHarness({ createManualJob: errManualJob() });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    // The fallback returns { speak } only — no data → deriveDisposition sees no explicit "work".
    expect(result.data).toBeUndefined();
    expect(deriveDisposition([{ tool: "book_visit", result }])).toBe("no_action");
  });

  it("failed booking files a 'call back' follow-up task linked to the ensured lead", async () => {
    // EnsureCustomer + CreateManualJob succeed, then CreateVisit fails → a lead exists to link.
    const h = buildHarness({ createVisit: errVisit("visit failed") });
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(h.tasks.created).toHaveLength(1);
    const task = h.tasks.created[0]!;
    expect(task.text).toContain("Booking attempt failed");
    expect(task.text).toContain("Jane Doe");
    expect(task.text).toContain("kitchen faucet dripping");
    expect(task.leadId).toBe(LEAD_UUID);
  });

  it("failed EnsureCustomer (no lead) files the follow-up task with a null leadId", async () => {
    // A blank caller_name makes EnsureCustomerUseCase return an err (name required) → no lead — the
    // "EnsureCustomer itself failed" path. The task must still be filed, with leadId null.
    const h = buildHarness();
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, caller_name: "   " }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.leadId).toBeNull();
    expect(h.tasks.created[0]!.text).toContain("Booking attempt failed");
  });

  it("a failed booking never sends a confirmation SMS", async () => {
    const h = buildHarness({ createManualJob: errManualJob() });
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("invalid phone never sends a confirmation SMS", async () => {
    const h = buildHarness();
    await bookVisitTool.handle({ ...REPAIR_INPUT, phone: "not-a-phone" }, h.ctx);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("zero-minute settings config is clamped so a POSITIVE duration reaches CreateVisit", async () => {
    // Guard layer 1: an org authored with 0 repair minutes is clamped by OrgSettings to the visit
    // floor (≥15m), so a positive durationHours always reaches CreateVisit — a zero/negative-minute
    // config can NEVER produce a 0/negative durationMinutes on the seeded visit.
    const h = buildHarness({ settings: settingsFrom({ visitRepairMinutes: 0 }) });
    await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    const visit = onlyJob(h).props.visits[0]!;
    expect(visit).toBeDefined();
    expect(visit.props.durationMinutes).not.toBeNull();
    expect(visit.props.durationMinutes!).toBeGreaterThan(0);
  });

  it("a 0/negative duration reaching CreateVisit (defense-in-depth) degrades to fallback + task", async () => {
    // Guard layer 2: if a 0/negative duration ever DID reach CreateVisit, the JobVisit domain rejects
    // it (positive, ≤1440) → CreateVisit errs → we degrade to the spoken fallback + a follow-up task,
    // never persisting a zero-duration visit.
    const h = buildHarness({
      createVisit: errVisit("visit duration must be 1–1440 whole minutes"),
    });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(result.data).toBeUndefined();
    // the job exists but no visit was seeded (the errored CreateVisit persisted nothing)
    expect(onlyJob(h).props.visits).toHaveLength(0);
    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toContain("Booking attempt failed");
  });
});
