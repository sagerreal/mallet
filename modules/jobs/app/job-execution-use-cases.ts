import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
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
  readonly itemId: number;
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
