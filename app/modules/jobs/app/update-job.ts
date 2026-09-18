import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job, JobChecklistProps, JobKind } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";

export interface UpdateJobCommand {
  readonly jobId: JobId;
  readonly title?: string | null;
  readonly svc?: string | null;
  readonly notes?: string | null;
  /** undefined = keep; null = detach; object = attach/replace the before-you-leave checklist. */
  readonly checklist?: JobChecklistProps | null;
  readonly addr?: string | null;
  readonly phone?: string | null;
  readonly completion?: string | null;
  readonly invRequested?: boolean;
  readonly kind?: JobKind;
}

// Edit a job's DB-backed fields. addr/phone/completion/invRequested USED to be accepted here and
// silently dropped for want of columns — the office job modal's Service address row and the
// close-out sheet's "What was done" edited nothing at all, and the next jobs.list refetch erased
// what had been typed. Terminal jobs reject via Job.patchFields (mirrors UpdateCompanyUseCase).

/**
 * The retired magic value, normalised at the boundary.
 *
 * Before 0133, "this is an estimate visit" travelled as svc='estimate'. A stale browser bundle
 * (SPAs outlive deploys; shops keep tabs open for days) still sends that shape — accepted
 * verbatim it would land as kind='work', svc='estimate': readable as an estimate by the client's
 * legacy fallback, invisible to every kind-based server predicate, and unrepairable by the Type
 * toggle. Normalising here turns the stale write into the correct row instead.
 */
const normalizeSvcKind = (
  svc: string | null | undefined,
  kind: JobKind | undefined,
): { svc: string | null; kind: JobKind | undefined } =>
  svc?.trim().toLowerCase() === "estimate"
    ? { svc: null, kind: kind ?? "estimate" }
    : { svc: svc ?? null, kind };

export class UpdateJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateJobCommand): Promise<Result<Job, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const now = this.clock.now();
    // svc===undefined must stay undefined (patchFields treats undefined as "keep") — only a
    // present svc value goes through normalisation.
    const norm = cmd.svc !== undefined ? normalizeSvcKind(cmd.svc, cmd.kind) : { svc: undefined, kind: cmd.kind };
    const patched = job.patchFields(
      {
        title: cmd.title,
        svc: norm.svc,
        notes: cmd.notes,
        checklist: cmd.checklist,
        addr: cmd.addr,
        phone: cmd.phone,
        completion: cmd.completion,
        invRequested: cmd.invRequested,
        kind: norm.kind,
      },
      now,
    );
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    await this.bus.emit({
      name: "job.updated",
      orgId: patched.value.props.orgId,
      payload: { jobId: patched.value.props.id },
      occurredAt: now,
    });
    logger.info({ jobId: cmd.jobId, orgId: patched.value.props.orgId }, "job.updated");
    return ok(patched.value);
  }
}
