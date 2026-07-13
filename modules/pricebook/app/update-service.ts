import type { ServiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Service } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";

export interface UpdateServiceCommand {
  readonly serviceId: ServiceId;
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly unitPriceCents?: number;
  readonly costCents?: number;
  readonly laborHours?: number | null;
  readonly taxable?: boolean;
  readonly warrantyText?: string | null;
  readonly imageUrl?: string | null;
  readonly isAddon?: boolean;
  readonly active?: boolean;
  readonly position?: number;
}

export class UpdateServiceUseCase {
  constructor(
    private readonly repo: ServiceRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateServiceCommand, orgId: string): Promise<Result<Service, AppError>> {
    const service = await this.repo.findById(cmd.serviceId);
    if (!service) return err(notFound("service not found"));

    const now = this.clock.now();
    const patched = service.patch(
      {
        name: cmd.name,
        categoryId: cmd.categoryId,
        code: cmd.code,
        description: cmd.description,
        unitPriceCents: cmd.unitPriceCents,
        costCents: cmd.costCents,
        laborHours: cmd.laborHours,
        taxable: cmd.taxable,
        warrantyText: cmd.warrantyText,
        imageUrl: cmd.imageUrl,
        isAddon: cmd.isAddon,
        active: cmd.active,
        position: cmd.position,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.repo.save(patched.value);

    logger.info({ serviceId: cmd.serviceId, orgId }, "pricebook.service.updated");

    return ok(patched.value);
  }
}
