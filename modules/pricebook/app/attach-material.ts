import type { AppError, MaterialId, Result, ServiceId } from "@mallet/shared/types";
import { asOrgId, notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { ServiceMaterial } from "../domain/service-material";
import type { ServiceMaterialRepository } from "../domain/service-material";
import type { MaterialRepository } from "../domain/material-repository";
import type { ServiceRepository } from "../domain/service-repository";

export interface AttachMaterialCommand {
  readonly serviceId: ServiceId;
  readonly materialId: MaterialId;
  readonly quantity: number;
}

export class AttachMaterialUseCase {
  constructor(
    private readonly serviceRepo: ServiceRepository,
    private readonly materialRepo: MaterialRepository,
    private readonly smRepo: ServiceMaterialRepository,
  ) {}

  async exec(cmd: AttachMaterialCommand, orgId: string): Promise<Result<void, AppError>> {
    // Fail-fast: both sides of the join must exist in-org, or the insert would create an
    // orphan FK (or silently attach across a tenant boundary).
    const service = await this.serviceRepo.findById(cmd.serviceId);
    if (!service) return err(notFound("service not found"));

    const material = await this.materialRepo.findById(cmd.materialId);
    if (!material) return err(notFound("material not found"));

    const joined = ServiceMaterial.create({
      orgId: asOrgId(orgId),
      serviceId: cmd.serviceId,
      materialId: cmd.materialId,
      quantity: cmd.quantity,
    });
    if (!joined.ok) return joined;

    await this.smRepo.attach({
      orgId,
      serviceId: cmd.serviceId,
      materialId: cmd.materialId,
      quantity: cmd.quantity,
    });

    logger.info(
      { serviceId: cmd.serviceId, materialId: cmd.materialId, orgId },
      "pricebook.material.attached",
    );

    return ok(undefined);
  }
}
