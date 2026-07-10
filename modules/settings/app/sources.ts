import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, conflict, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { LeadSource, SettingsRepository } from "../domain/settings-repository";

// --- Create ---------------------------------------------------------------

export interface CreateSourceCommand {
  readonly id?: string;
  readonly label: string;
  readonly position?: number;
}

export class CreateSourceUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateSourceCommand, orgId: string): Promise<Result<LeadSource, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const existing = await this.repo.listSources();
    const isDuplicate = existing.some((s) => s.label.toLowerCase() === label.toLowerCase());
    if (isDuplicate) return err(conflict("source already exists"));
    const source = await this.repo.createSource({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      label,
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: source.id }, "settings.source.created");
    return ok(source);
  }
}

// --- Update ---------------------------------------------------------------

export interface UpdateSourceCommand {
  readonly id: string;
  readonly label?: string;
  readonly position?: number;
}

export class UpdateSourceUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateSourceCommand, orgId: string): Promise<Result<LeadSource, AppError>> {
    const existing = (await this.repo.listSources()).find((s) => s.id === cmd.id);
    if (!existing) return err(notFound("source not found"));
    if (cmd.label !== undefined && cmd.label.trim().length === 0) {
      return err(validation("label is required", "label"));
    }
    const next: LeadSource = {
      id: existing.id,
      label: cmd.label !== undefined ? cmd.label.trim() : existing.label,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.saveSource(next, this.clock.now());
    if (count === 0) return err(notFound("source not found"));
    logger.info({ orgId, id: next.id }, "settings.source.updated");
    return ok(next);
  }
}

// --- Remove ---------------------------------------------------------------

export interface RemoveSourceCommand {
  readonly id: string;
}

export class RemoveSourceUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveSourceCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archiveSource(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("source not found"));
    logger.info({ orgId, id: cmd.id }, "settings.source.removed");
    return ok({ ok: true });
  }
}
