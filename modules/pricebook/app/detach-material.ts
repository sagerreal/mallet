import type { AppError, MaterialId, Result, ServiceId } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { ServiceMaterialRepository } from "../domain/service-material";

export interface DetachMaterialCommand {
  readonly serviceId: ServiceId;
  readonly materialId: MaterialId;
}

export class DetachMaterialUseCase {
  constructor(private readonly smRepo: ServiceMaterialRepository) {}

  async exec(
    cmd: DetachMaterialCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.smRepo.detach(cmd.serviceId, cmd.materialId);
    if (count === 0) return err(notFound("service-material attachment not found"));

    logger.info(
      { serviceId: cmd.serviceId, materialId: cmd.materialId, orgId },
      "pricebook.material.detached",
    );

    return ok({ ok: true });
  }
}
