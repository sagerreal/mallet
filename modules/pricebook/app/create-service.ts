import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, conflict, ok, err, toPage } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Service } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";

export interface CreateServiceCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly name: string;
  readonly categoryId?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly unitPriceCents: number;
  readonly costCents: number;
  readonly laborHours?: number | null;
  readonly taxable?: boolean;
  readonly warrantyText?: string | null;
  readonly imageUrl?: string | null;
  readonly isAddon?: boolean;
  readonly active?: boolean;
  readonly position?: number;
}

export class CreateServiceUseCase {
  constructor(
    private readonly repo: ServiceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateServiceCommand, orgId: string): Promise<Result<Service, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("service name is required", "name"));

    // Dedupe by name, case-insensitive: search narrows the scan to name matches (uses the
    // name index) rather than a full-table list scan.
    const candidates = await this.repo.list(toPage(), { search: name });
    const isDuplicate = candidates.items.some(
      (s) => s.props.name.toLowerCase() === name.toLowerCase(),
    );
    if (isDuplicate) return err(conflict("a service with this name already exists"));

    const service = await this.repo.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      categoryId: cmd.categoryId ?? null,
      code: cmd.code ?? null,
      name,
      description: cmd.description ?? null,
      unitPriceCents: Math.max(0, Math.round(cmd.unitPriceCents)),
      costCents: Math.max(0, Math.round(cmd.costCents)),
      laborHours: cmd.laborHours ?? null,
      taxable: cmd.taxable ?? false,
      warrantyText: cmd.warrantyText ?? null,
      imageUrl: cmd.imageUrl ?? null,
      isAddon: cmd.isAddon ?? false,
      active: cmd.active ?? true,
      position: cmd.position ?? 0,
    });

    logger.info({ serviceId: service.props.id, orgId }, "pricebook.service.created");

    return ok(service);
  }
}
