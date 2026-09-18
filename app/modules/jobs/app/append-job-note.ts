import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface AppendJobNoteCommand {
  readonly jobId: JobId;
  readonly text: string;
}

/**
 * Add ONE line to a job's notes feed.
 *
 * APPENDING IS THE WHOLE POINT, and it belongs here rather than in the browser. The office
 * composer read `job.notes`, appended in the client, and wrote the WHOLE blob back through
 * jobs.update — so two people adding a note inside one round trip each wrote their own version of
 * the field, and whoever landed second erased the other's note. A tech at the door and the office
 * on the phone is exactly the moment that happens.
 *
 * Reading the job here means the append lands on whatever the field holds NOW.
 *
 * The stamp is the same "[Aug 14] " shape the feed already parses (jobNoteEntries), so notes
 * written from either surface read identically and no migration is owed for the ones already
 * stored.
 */
export class AppendJobNoteUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: AppendJobNoteCommand): Promise<Result<Job, AppError>> {
    const text = cmd.text.trim();
    // An empty note would stamp a dated blank line into the feed — a record that something was
    // said, saying nothing.
    if (!text) return err(validation("a note needs some words", "text"));

    const job = await this.jobs.findById(cmd.jobId);
    if (!job) return err(notFound("job"));

    const now = this.clock.now();
    const stamp = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const existing = (job.props.notes ?? "").trim();
    const notes = existing ? `${existing}\n[${stamp}] ${text}` : `[${stamp}] ${text}`;

    // patchFields owns the terminal-job rule, so a finished job refuses here exactly as it does
    // for every other job write rather than by a second copy of the check.
    const patched = job.patchFields({ notes }, now);
    if (!isOk(patched)) return patched;

    await this.jobs.save(patched.value);
    logger.info({ jobId: cmd.jobId }, "job.note.appended");
    return ok(patched.value);
  }
}
