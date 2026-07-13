import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, conflict, ok, err, toPage } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Material } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";

export interface CreateMaterialCommand {
  readonly id?: string; // client-authored id; a new one is minted when absent
  readonly name: string;
  readonly categoryId?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly unitCostCents: number;
  readonly unitOfMeasure?: string;
  readonly markupBps?: number | null;
  readonly taxable?: boolean;
  readonly vendor?: string | null;
  readonly active?: boolean;
  readonly position?: number;
}

export class CreateMaterialUseCase {
  constructor(
    private readonly repo: MaterialRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateMaterialCommand, orgId: string): Promise<Result<Material, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("material name is required", "name"));

    const markupBps = cmd.markupBps ?? null;
    if (markupBps !== null && markupBps < 0) {
      return err(validation("markup must be ≥ 0", "markupBps"));
    }

    // Dedupe by name, case-insensitive: search narrows the scan to name matches (uses the
    // name index) rather than a full-table list scan.
    const candidates = await this.repo.list(toPage(), { search: name });
    const isDuplicate = candidates.items.some(
      (m) => m.props.name.toLowerCase() === name.toLowerCase(),
    );
    if (isDuplicate) return err(conflict("a material with this name already exists"));

    const material = await this.repo.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      categoryId: cmd.categoryId ?? null,
      code: cmd.code ?? null,
      name,
      description: cmd.description ?? null,
      unitCostCents: Math.max(0, Math.round(cmd.unitCostCents)),
      unitOfMeasure: cmd.unitOfMeasure ?? "each",
      markupBps,
      taxable: cmd.taxable ?? false,
      vendor: cmd.vendor ?? null,
      active: cmd.active ?? true,
      position: cmd.position ?? 0,
    });

    logger.info({ materialId: material.props.id, orgId }, "pricebook.material.created");

    return ok(material);
  }
}
