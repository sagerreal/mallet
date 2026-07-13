import type { MaterialId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Material } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";

export interface UpdateMaterialCommand {
  readonly materialId: MaterialId;
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly unitCostCents?: number;
  readonly unitOfMeasure?: string;
  readonly markupBps?: number | null;
  readonly taxable?: boolean;
  readonly vendor?: string | null;
  readonly active?: boolean;
  readonly position?: number;
}

export class UpdateMaterialUseCase {
  constructor(
    private readonly repo: MaterialRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateMaterialCommand, orgId: string): Promise<Result<Material, AppError>> {
    const material = await this.repo.findById(cmd.materialId);
    if (!material) return err(notFound("material not found"));

    const now = this.clock.now();
    const patched = material.patch(
      {
        categoryId: cmd.categoryId,
        code: cmd.code,
        name: cmd.name,
        description: cmd.description,
        unitCostCents: cmd.unitCostCents,
        unitOfMeasure: cmd.unitOfMeasure,
        markupBps: cmd.markupBps,
        taxable: cmd.taxable,
        vendor: cmd.vendor,
        active: cmd.active,
        position: cmd.position,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.repo.save(patched.value);

    logger.info({ materialId: cmd.materialId, orgId }, "pricebook.material.updated");

    return ok(patched.value);
  }
}
