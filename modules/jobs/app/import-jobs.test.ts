import { describe, it, expect, beforeEach, vi } from "vitest";
import { asOrgId, asLeadId, asJobId, FixedClock, ok, err, validation } from "@mallet/shared/types";
import { ImportJobsUseCase, type ImportJobRow } from "./import-jobs";
import type { CreateManualJobUseCase } from "./create-manual-job";
import type { CreateVisitUseCase } from "./create-visit";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB = asJobId("44444444-4444-4444-4444-444444444444");

/** Mon–Fri open at 08:00, Sat 09:00, Sun closed (0). Index 0 = Sunday. */
const HOURS = [0, 8, 8, 8, 8, 8, 9];

const row = (over: Partial<ImportJobRow> = {}): ImportJobRow => ({
  leadId: LEAD,
  svc: "Water heater swap",
  scope: null,
  addr: null,
  status: "scheduled",
  scheduledDate: null,
  scheduledStart: null,
  ...over,
});

describe("ImportJobsUseCase", () => {
  let createJob: { exec: ReturnType<typeof vi.fn> };
  let createVisit: { exec: ReturnType<typeof vi.fn> };
  let useCase: ImportJobsUseCase;

  beforeEach(() => {
    createJob = { exec: vi.fn().mockResolvedValue(ok({ props: { id: JOB } })) };
    createVisit = { exec: vi.fn().mockResolvedValue(ok({ props: { id: JOB } })) };
    useCase = new ImportJobsUseCase(
      createJob as unknown as CreateManualJobUseCase,
      createVisit as unknown as CreateVisitUseCase,
      new FixedClock(new Date("2026-08-12T10:00:00Z")),
      { newId: () => "id" },
    );
  });

  const run = (rows: ImportJobRow[]) => useCase.exec({ orgId: ORG, rows, openHourByWeekday: HOURS });

  it("creates a job per row and reports the count", async () => {
    const result = await run([row(), row()]);
    expect(result.ok && result.value.created).toBe(2);
    expect(createJob.exec).toHaveBeenCalledTimes(2);
  });

  it("imports jobs as work, never as a pre-quote estimate visit", async () => {
    await run([row()]);
    expect(createJob.exec.mock.calls[0]![0]).toMatchObject({ kind: "work" });
  });

  it("titles the job from the Service column instead of leaving every import called 'Job'", async () => {
    // title was hard-coded null, and both mappers render `dto.title ?? "Job"` — so a 200-row
    // import produced 200 rows all reading "Job", with the service text sitting unused in svc.
    await run([row({ svc: "Water heater swap" })]);
    expect(createJob.exec.mock.calls[0]![0]).toMatchObject({ title: "Water heater swap" });
  });

  it("falls back to the scope text when the sheet has no Service column", async () => {
    await run([row({ svc: null, scope: "Replace pressure valve, garage" })]);
    expect(createJob.exec.mock.calls[0]![0]).toMatchObject({ title: "Replace pressure valve, garage" });
  });

  it("leaves the title unset when the row says nothing either way", async () => {
    await run([row({ svc: "   ", scope: null })]);
    expect(createJob.exec.mock.calls[0]![0]).toMatchObject({ title: null });
  });

  it("titles an estimate row before normalizeSvcKind nulls its svc", async () => {
    // create-manual-job nulls svc when it reads "estimate", so a title derived downstream would
    // be lost for exactly those rows.
    await run([row({ svc: "Estimate", scope: "Roof drain survey" })]);
    expect(createJob.exec.mock.calls[0]![0]).toMatchObject({ title: "Estimate" });
  });

  it("leaves an undated row unscheduled rather than dropping it", async () => {
    const result = await run([row({ scheduledDate: null })]);
    expect(result.ok && result.value.created).toBe(1);
    expect(createVisit.exec).not.toHaveBeenCalled();
  });

  it("places a dated row on the board", async () => {
    // 2026-08-12 is a Wednesday.
    await run([row({ scheduledDate: "2026-08-12", scheduledStart: "14:30" })]);
    expect(createVisit.exec).toHaveBeenCalledTimes(1);
    expect(createVisit.exec.mock.calls[0]![0]).toMatchObject({
      scheduledDate: "2026-08-12",
      scheduledStart: "14:30",
    });
  });

  it("falls back to the weekday's opening hour when the row has a date but no time", async () => {
    await run([row({ scheduledDate: "2026-08-12" })]); // Wednesday → 08:00
    expect(createVisit.exec.mock.calls[0]![0]).toMatchObject({ scheduledStart: "08:00" });
  });

  it("uses Saturday's own opening hour, not the weekday one", async () => {
    await run([row({ scheduledDate: "2026-08-15" })]); // Saturday → 09:00
    expect(createVisit.exec.mock.calls[0]![0]).toMatchObject({ scheduledStart: "09:00" });
  });

  it("does not place a closed day's job at midnight", async () => {
    await run([row({ scheduledDate: "2026-08-16" })]); // Sunday, closed (0)
    expect(createVisit.exec.mock.calls[0]![0]).toMatchObject({ scheduledStart: "08:00" });
  });

  it("counts a rejected row as failed without derailing the rest", async () => {
    createJob.exec
      .mockResolvedValueOnce(err(validation("lead is required", "leadId")))
      .mockResolvedValueOnce(ok({ props: { id: JOB } }));

    const result = await run([row(), row()]);

    expect(result.ok && result.value.created).toBe(1);
    expect(result.ok && result.value.failed).toBe(1);
    expect(result.ok && result.value.errors[0]!.index).toBe(0);
  });

  it("keeps a job whose visit could not be placed, and says so", async () => {
    createVisit.exec.mockResolvedValueOnce(err(validation("bad date", "scheduledDate")));

    const result = await run([row({ scheduledDate: "2026-08-12" })]);

    // The job is real and usable; only its placement failed.
    expect(result.ok && result.value.created).toBe(1);
    expect(result.ok && result.value.failed).toBe(0);
    expect(result.ok && result.value.errors[0]!.message).toContain("visit could not be scheduled");
  });

  it("reports rows whose customer name was ambiguous", async () => {
    const result = await run([row(), row({ ambiguousName: "Gary Pratt" })]);

    expect(result.ok && result.value.ambiguous).toEqual([{ index: 1, name: "Gary Pratt" }]);
    expect(result.ok && result.value.created).toBe(2); // still imported
  });
});
