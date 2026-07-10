import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, notFound, conflict, ok, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { LaborRate, SettingsRepository } from "../domain/settings-repository";

// Org must always have at least one active labor rate (matches prototype guard).
const MIN_ACTIVE_LABOR_RATES = 1;

// --- Create ---------------------------------------------------------------

export interface CreateLaborRateCommand {
  readonly id?: string;
  readonly label: string;
  readonly rateCentsPerHour: number;
  readonly position?: number;
}

export class CreateLaborRateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateLaborRateCommand, orgId: string): Promise<Result<LaborRate, AppError>> {
    const label = cmd.label.trim();
    if (label.length === 0) return err(validation("label is required", "label"));
    const rate = await this.repo.createLaborRate({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      label,
      rateCentsPerHour: Math.max(0, Math.round(cmd.rateCentsPerHour)),
      position: cmd.position ?? 0,
    });
    logger.info({ orgId, id: rate.id }, "settings.laborRate.created");
    return ok(rate);
  }
}

// --- Update ---------------------------------------------------------------

export interface UpdateLaborRateCommand {
  readonly id: string;
  readonly label?: string;
  readonly rateCentsPerHour?: number;
  readonly position?: number;
}

export class UpdateLaborRateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateLaborRateCommand, orgId: string): Promise<Result<LaborRate, AppError>> {
    const existing = (await this.repo.listLaborRates()).find((r) => r.id === cmd.id);
    if (!existing) return err(notFound("labor rate not found"));
    if (cmd.label !== undefined && cmd.label.trim().length === 0) {
      return err(validation("label is required", "label"));
    }
    const next: LaborRate = {
      id: existing.id,
      label: cmd.label !== undefined ? cmd.label.trim() : existing.label,
      rateCentsPerHour: cmd.rateCentsPerHour !== undefined
        ? Math.max(0, Math.round(cmd.rateCentsPerHour))
        : existing.rateCentsPerHour,
      position: cmd.position !== undefined ? cmd.position : existing.position,
    };
    const count = await this.repo.saveLaborRate(next);
    if (count === 0) return err(notFound("labor rate not found"));
    logger.info({ orgId, id: next.id }, "settings.laborRate.updated");
    void this.clock.now(); // stamp available for future use
    return ok(next);
  }
}

// --- Remove ---------------------------------------------------------------

export interface RemoveLaborRateCommand {
  readonly id: string;
}

export class RemoveLaborRateUseCase {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveLaborRateCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    // Invariant: never remove the last active rate — the org must always have ≥1.
    const activeCount = await this.repo.countActiveLaborRates();
    if (activeCount <= MIN_ACTIVE_LABOR_RATES) {
      return err(conflict("cannot remove the last labor rate"));
    }
    const count = await this.repo.archiveLaborRate(cmd.id, this.clock.now());
    if (count === 0) return err(notFound("labor rate not found"));
    logger.info({ orgId, id: cmd.id }, "settings.laborRate.removed");
    return ok({ ok: true });
  }
}
