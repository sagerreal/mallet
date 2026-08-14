import { describe, it, expect, vi } from "vitest";
import { asJobId, FixedClock, ok, err, isOk, validation } from "@mallet/shared/types";
import { AppendJobNoteUseCase } from "./append-job-note";
import type { Job } from "../domain/job";

const JOB = asJobId("44444444-4444-4444-4444-444444444444");
const NOW = new Date("2026-08-14T19:00:00Z");

/** A job stub that records what patchFields was asked to write. */
function jobWith(notes: string | null, terminal = false) {
  const calls: { notes?: string | null }[] = [];
  const job = {
    props: { id: JOB, notes },
    isTerminal: () => terminal,
    // Models the real Job.patchFields contract: a terminal job refuses every field write. The
    // use-case delegates that rule rather than keeping a second copy, so the stub has to carry it
    // or the delegation is not what is being tested.
    patchFields: (fields: { notes?: string | null }) => {
      if (terminal) return err(validation("cannot edit a completed or canceled job", "status"));
      calls.push(fields);
      return ok({ props: { id: JOB, notes: fields.notes ?? notes } } as unknown as Job);
    },
  } as unknown as Job;
  return { job, calls };
}

const deps = (job: Job) => ({
  repo: { findById: vi.fn(async () => job), save: vi.fn(async () => undefined) },
  clock: new FixedClock(NOW),
});

describe("AppendJobNoteUseCase", () => {
  // THE POINT OF DOING THIS SERVER-SIDE. The office composer read job.notes in the browser,
  // appended, and wrote the WHOLE blob back. Two people adding a note within one round trip each
  // wrote their own version of the field, so whoever landed second erased the other's note. A tech
  // at the door and the office on the phone is exactly when that happens.
  it("appends to whatever the job holds NOW, not to a blob the caller carried", async () => {
    const { job, calls } = jobWith("[Aug 13] office: gate code 4417");
    const d = deps(job);

    const r = await new AppendJobNoteUseCase(d.repo as never, d.clock).exec({
      jobId: JOB,
      text: "main stack is cracked below the tee",
    });

    expect(isOk(r)).toBe(true);
    expect(calls[0]?.notes).toBe(
      "[Aug 13] office: gate code 4417\n[Aug 14] main stack is cracked below the tee",
    );
  });

  it("starts the feed when the job has no notes", async () => {
    const { job, calls } = jobWith(null);
    const d = deps(job);

    await new AppendJobNoteUseCase(d.repo as never, d.clock).exec({ jobId: JOB, text: "first" });

    expect(calls[0]?.notes).toBe("[Aug 14] first");
  });

  it("refuses an empty note rather than stamping a blank line", async () => {
    const { job, calls } = jobWith("existing");
    const d = deps(job);

    const r = await new AppendJobNoteUseCase(d.repo as never, d.clock).exec({ jobId: JOB, text: "   " });

    expect(isOk(r)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses a note on a finished job — the same rule every other job write follows", async () => {
    const { job, calls } = jobWith("existing", true);
    const d = deps(job);

    const r = await new AppendJobNoteUseCase(d.repo as never, d.clock).exec({ jobId: JOB, text: "late" });

    expect(isOk(r)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("says so when the job is gone", async () => {
    const repo = { findById: vi.fn(async () => null), save: vi.fn() };

    const r = await new AppendJobNoteUseCase(repo as never, new FixedClock(NOW)).exec({
      jobId: JOB,
      text: "anything",
    });

    expect(isOk(r)).toBe(false);
  });
});
