import type { MaterialId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Material } from "../domain/material";
import type { MaterialRepository, MarkupBandsRepository } from "../domain/material-repository";
import { deriveSellPriceCents } from "../domain/markup-bands";

export interface UpdateMaterialCommand {
  readonly materialId: MaterialId;
  readonly name?: string;
  readonly categoryId?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly unitCostCents?: number;
  /** Direct price edit — flips the item to manual (HCP one-gesture override). */
  readonly unitPriceCents?: number;
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
    private readonly bands: MarkupBandsRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateMaterialCommand, orgId: string): Promise<Result<Material, AppError>> {
    const material = await this.repo.findById(cmd.materialId);
    if (!material) return err(notFound("material not found"));

    const now = this.clock.now();
    // Sell-side interplay (locked spec): a direct price edit flips the item to MANUAL and
    // sticks; a cost edit on a RULE item re-derives the sell price from the org's bands;
    // a cost edit on a manual item touches cost only. Existing quotes never move (snapshot).
    let sell: { unitPriceCents?: number; pricingMode?: "rule" | "manual" } = {};
    if (cmd.unitPriceCents !== undefined) {
      sell = { unitPriceCents: Math.max(0, Math.round(cmd.unitPriceCents)), pricingMode: "manual" };
    } else if (cmd.unitCostCents !== undefined && material.props.pricingMode === "rule") {
      sell = {
        unitPriceCents: deriveSellPriceCents(
          Math.max(0, Math.round(cmd.unitCostCents)),
          await this.bands.list(),
        ),
      };
    }
    const patched = material.patch(
      {
        ...sell,
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
