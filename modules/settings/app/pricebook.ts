import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { PricebookItem, SettingsRepository } from "../domain/settings-repository";

// --- Create ---------------------------------------------------------------

export interface CreatePricebookCommand {
  readonly id?: string;
  readonly label: string;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly position?: number;
}

export class CreatePricebookUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreatePricebookCommand, orgId: string): Promise<Result<PricebookItem, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const item = await this.repo.createPricebook({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      label,
      unitPriceCents: Math.max(0, Math.round(cmd.unitPriceCents)),
      costCents: Math.max(0, Math.round(cmd.costCents)),
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: item.id }, "settings.pricebook.created");
    return ok(item);
  }
}

// --- Update ---------------------------------------------------------------

export interface UpdatePricebookCommand {
  readonly id: string;
  readonly label?: string;
  readonly unitPriceCents?: number;
  readonly costCents?: number;
  readonly position?: number;
}

export class UpdatePricebookUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdatePricebookCommand, orgId: string): Promise<Result<PricebookItem, AppError>> {
    const existing = (await this.repo.listPricebook()).find((p) => p.id === cmd.id);
    if (!existing) return err(notFound("pricebook item not found"));
    if (cmd.label !== undefined && cmd.label.trim().length === 0) {
      return err(validation("label is required", "label"));
    }
    const next: PricebookItem = {
      id: existing.id,
      label: cmd.label !== undefined ? cmd.label.trim() : existing.label,
      unitPriceCents: cmd.unitPriceCents !== undefined
        ? Math.max(0, Math.round(cmd.unitPriceCents))
        : existing.unitPriceCents,
      costCents: cmd.costCents !== undefined
        ? Math.max(0, Math.round(cmd.costCents))
        : existing.costCents,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.savePricebook(next, this.clock.now());
    if (count === 0) return err(notFound("pricebook item not found"));
    logger.info({ orgId, id: next.id }, "settings.pricebook.updated");
    return ok(next);
  }
}

// --- Remove ---------------------------------------------------------------

export interface RemovePricebookCommand {
  readonly id: string;
}

export class RemovePricebookUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemovePricebookCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archivePricebook(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("pricebook item not found"));
    logger.info({ orgId, id: cmd.id }, "settings.pricebook.removed");
    return ok({ ok: true });
  }
}
