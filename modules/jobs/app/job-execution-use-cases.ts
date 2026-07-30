import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, validation } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { buildJobSignature } from "../domain/job-signature";
import type { JobSignature } from "../domain/job-signature";
import type { SignatureDraft } from "../../quoting/domain/signature";
import {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
  type AddonStatus,
} from "../domain/job-execution";

// The unit every execution use-case returns: the (still-loaded) job header + its refreshed child
// collections. The router maps this into the full jobDTO so the client re-syncs the whole job.
export interface JobWithExecution {
  readonly job: Job;
  readonly execution: {
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  };
}

// Load the job (fail-closed not_found) + its execution collections for the return value.
async function loadOrThrow(
  repo: JobRepository,
  jobId: JobId,
): Promise<Result<JobWithExecution, AppError>> {
  const job = await repo.findById(jobId);
  if (!job) return err(notFound("job not found"));
  const execution = await repo.listExecution(jobId);
  return ok({ job, execution });
}

export interface AddJobLineCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly position?: number;
}

export class AddJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const line = JobLine.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      position: cmd.position ?? 0,
    });
    if (!line.ok) return line;
    await this.repo.addLine(line.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_line.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface UpdateJobLineCommand {
  readonly jobId: JobId;
  readonly lineId: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly position: number;
}

export class UpdateJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const line = JobLine.create({
      id: cmd.lineId,
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      position: cmd.position,
    });
    if (!line.ok) return line;
    const affected = await this.repo.updateLine(line.value, this.clock.now());
    if (affected === 0) return err(notFound("job line not found"));
    logger.info({ jobId: cmd.jobId, lineId: cmd.lineId, orgId }, "job_line.updated");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface SetJobLinesLine {
  readonly id?: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
}

export interface SetJobLinesCommand {
  readonly jobId: JobId;
  readonly lines: readonly SetJobLinesLine[];
  /**
   * On-glass signature captured with this price. Absent on every office path — pricing a job in
   * the office is not a customer agreeing to anything, and forcing a signature there would make
   * the office lie or become unusable.
   */
  readonly signature?: SignatureDraft;
  /** Shop name for the authorisation sentence. Required alongside a signature. */
  readonly orgName?: string;
  /** The staff member whose device took it — the in-person witness. */
  readonly signedByUserId?: string | null;
}

// Bulk-replace a job's lines in one atomic swap (soft-delete current + insert new). Used by
// the on-site pricing paths (tech quote sign / office price builder) which build a complete
// line set in one shot; every line is validated through JobLine.create before the write, and
// position is the array index so line order is preserved.
export class SetJobLinesUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SetJobLinesCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const built: JobLine[] = [];
    for (let i = 0; i < cmd.lines.length; i++) {
      const input = cmd.lines[i]!;
      const line = JobLine.create({
        id: input.id ?? this.ids.newId(),
        jobId: cmd.jobId,
        description: input.description,
        quantity: input.quantity,
        rateCents: input.rateCents,
        costCents: input.costCents,
        position: i,
      });
      if (!line.ok) return line;
      built.push(line.value);
    }
    const now = this.clock.now();

    // Signature FIRST, before anything is written. buildJobSignature freezes the snapshot from
    // `built` — the exact lines about to be persisted — and rejects a blank name. Validating after
    // the write would leave the price saved and the signature refused, which is the state the
    // customer least expects: they watched themselves sign and the shop holds only a number.
    let signature: JobSignature | null = null;
    if (cmd.signature) {
      const result = buildJobSignature({
        draft: cmd.signature,
        lines: built,
        orgName: cmd.orgName ?? "",
        signedAt: now,
      });
      if (!result.ok) return result;
      signature = result.value;
    }

    await this.repo.replaceLines(cmd.jobId, built, now);
    if (signature) {
      // Same tenant tx as the line write — the orgTx re-throw guard rolls both back together, so a
      // signature can never outlive the prices it refers to.
      await this.repo.saveOnSiteSignature(cmd.jobId, signature, cmd.signedByUserId ?? null, now);
      logger.info({ jobId: cmd.jobId, orgId, totalCents: signature.snapshot.totalCents }, "job.signed_on_site");
    }
    logger.info({ jobId: cmd.jobId, count: built.length, orgId }, "job_lines.replaced");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface RemoveJobLineCommand {
  readonly jobId: JobId;
  readonly lineId: string;
}

export class RemoveJobLineUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveJobLineCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.removeLine(cmd.jobId, cmd.lineId, this.clock.now());
    if (affected === 0) return err(notFound("job line not found"));
    logger.info({ jobId: cmd.jobId, lineId: cmd.lineId, orgId }, "job_line.removed");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface AddJobAddonCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly isOptional?: boolean;
  readonly position?: number;
}

export class AddJobAddonUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobAddonCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    const addon = JobAddon.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      description: cmd.description,
      quantity: cmd.quantity,
      rateCents: cmd.rateCents,
      costCents: cmd.costCents,
      isOptional: cmd.isOptional ?? false,
      invoiceSkip: false,
      status: "proposed",
      position: cmd.position ?? 0,
    });
    if (!addon.ok) return addon;
    await this.repo.addAddon(addon.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_addon.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface SetAddonStatusCommand {
  readonly jobId: JobId;
  readonly addonId: string;
  readonly status: AddonStatus;
}

export class SetAddonStatusUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetAddonStatusCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.setAddonStatus(cmd.jobId, cmd.addonId, cmd.status, this.clock.now());
    if (affected === 0) return err(notFound("job add-on not found"));
    logger.info({ jobId: cmd.jobId, addonId: cmd.addonId, status: cmd.status, orgId }, "job_addon.status_set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface SetAddonInvoiceSkipCommand {
  readonly jobId: JobId;
  readonly addonId: string;
  readonly invoiceSkip: boolean;
}

export class SetAddonInvoiceSkipUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetAddonInvoiceSkipCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.setAddonInvoiceSkip(cmd.jobId, cmd.addonId, cmd.invoiceSkip, this.clock.now());
    if (affected === 0) return err(notFound("job add-on not found"));
    logger.info({ jobId: cmd.jobId, addonId: cmd.addonId, orgId }, "job_addon.invoice_skip_set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

// state 'clear' removes the answer (mirrors uncheckVerifyItem); pass|override upsert one.
export interface SetVerifyAnswerCommand {
  readonly jobId: JobId;
  readonly itemId: string;
  readonly state: "pass" | "override" | "clear";
  readonly via: string | null;
  readonly reason: string | null;
}

export class SetVerifyAnswerUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetVerifyAnswerCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    // Answers only exist for items on the job's ATTACHED checklist. Without this, any
    // itemId upserts a fresh row (row spam) and answers written before a checklist is
    // attached pre-seed its items as already checked. Applies to every role and to
    // "clear" too — clearing a nonexistent item is a caller bug, not a no-op.
    const checklist = job.props.checklist;
    if (!checklist) {
      return err(validation("this job has no checklist attached — nothing to check off", "itemId"));
    }
    if (!checklist.items.some((item) => item.id === cmd.itemId)) {
      return err(notFound("that item isn't on this job's checklist"));
    }
    if (cmd.state === "clear") {
      await this.repo.removeVerifyAnswer(cmd.jobId, cmd.itemId);
      logger.info({ jobId: cmd.jobId, itemId: cmd.itemId, orgId }, "job_verify.cleared");
      return loadOrThrow(this.repo, cmd.jobId);
    }
    const answer = JobVerifyAnswer.create({
      jobId: cmd.jobId,
      itemId: cmd.itemId,
      state: cmd.state,
      via: cmd.via,
      reason: cmd.reason,
    });
    if (!answer.ok) return answer;
    await this.repo.upsertVerifyAnswer(answer.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, itemId: cmd.itemId, state: cmd.state, orgId }, "job_verify.set");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface AddJobPhotoCommand {
  readonly jobId: JobId;
  readonly id?: string;
  readonly storagePath: string;
  readonly caption: string | null;
  readonly verifyPass: boolean;
  readonly position?: number;
}

export class AddJobPhotoUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: AddJobPhotoCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));
    // The storage key layout is <org_id>/<job_id>/<uuid>.<ext>. photoUploadUrl mints this
    // server-side, but addPhoto accepts the path from the client — so reject any path that
    // isn't within this job's own org/job folder (defense-in-depth against a forged prefix).
    const prefix = `${orgId}/${cmd.jobId}/`;
    if (!cmd.storagePath.startsWith(prefix)) {
      return err(validation("storage path must be within the job's folder", "storagePath"));
    }
    const photo = JobPhoto.create({
      id: cmd.id ?? this.ids.newId(),
      jobId: cmd.jobId,
      storagePath: cmd.storagePath,
      caption: cmd.caption,
      verifyPass: cmd.verifyPass,
      position: cmd.position ?? 0,
    });
    if (!photo.ok) return photo;
    await this.repo.addPhoto(photo.value, this.clock.now());
    logger.info({ jobId: cmd.jobId, orgId }, "job_photo.added");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

export interface RemoveJobPhotoCommand {
  readonly jobId: JobId;
  readonly photoId: string;
}

export class RemoveJobPhotoUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveJobPhotoCommand, orgId: string): Promise<Result<JobWithExecution, AppError>> {
    const affected = await this.repo.removePhoto(cmd.jobId, cmd.photoId, this.clock.now());
    if (affected === 0) return err(notFound("job photo not found"));
    logger.info({ jobId: cmd.jobId, photoId: cmd.photoId, orgId }, "job_photo.removed");
    return loadOrThrow(this.repo, cmd.jobId);
  }
}
