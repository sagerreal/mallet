import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { JobTerm, SettingsRepository } from "../domain/settings-repository";

// --- Create ---------------------------------------------------------------

export interface CreateTermCommand {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly position?: number;
}

export class CreateTermUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateTermCommand, orgId: string): Promise<Result<JobTerm, AppError>> {
    const title = cmd.title.trim();
    const body = cmd.body.trim();
    if (title.length === 0) return err(validation("title is required", "title"));
    if (body.length === 0) return err(validation("body is required", "body"));
    const term = await this.repo.createTerm({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      title,
      body,
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: term.id }, "settings.term.created");
    return ok(term);
  }
}

// --- Update ---------------------------------------------------------------

export interface UpdateTermCommand {
  readonly id: string;
  readonly title?: string;
  readonly body?: string;
  readonly position?: number;
}

export class UpdateTermUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateTermCommand, orgId: string): Promise<Result<JobTerm, AppError>> {
    const existing = (await this.repo.listTerms()).find((t) => t.id === cmd.id);
    if (!existing) return err(notFound("term not found"));
    if (cmd.title !== undefined && cmd.title.trim().length === 0) {
      return err(validation("title is required", "title"));
    }
    if (cmd.body !== undefined && cmd.body.trim().length === 0) {
      return err(validation("body is required", "body"));
    }
    const next: JobTerm = {
      id: existing.id,
      title: cmd.title !== undefined ? cmd.title.trim() : existing.title,
      body: cmd.body !== undefined ? cmd.body.trim() : existing.body,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.saveTerm(next);
    if (count === 0) return err(notFound("term not found"));
    logger.info({ orgId, id: next.id }, "settings.term.updated");
    void this.clock.now(); // stamp available for future use
    return ok(next);
  }
}

// --- Remove ---------------------------------------------------------------

export interface RemoveTermCommand {
  readonly id: string;
}

export class RemoveTermUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveTermCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archiveTerm(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("term not found"));
    logger.info({ orgId, id: cmd.id }, "settings.term.removed");
    return ok({ ok: true });
  }
}
