import type { Result, AppError, Clock, OrgId } from "@mallet/shared/types";
import { conflict, ok, err, asAssemblyId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { Assembly, type MeasurementBasis, type PricingMode } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";

export interface CreateAssemblyCommand {
  /** Client may author the id for optimistic UI (createTask/createVisit pattern). */
  readonly id?: string;
  readonly name: string;
  readonly measurementBasis: MeasurementBasis;
  readonly pricingMode: PricingMode;
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  /** Untrusted blob — Assembly.create runs it through the versioned schema. */
  readonly config: unknown;
  readonly position?: number;
}

/**
 * A custom (org-authored) assembly — the API surface behind a future "add your
 * own scope" editor and the int tests' CRUD coverage. Shipped defaults are
 * never created this way (they materialize copy-on-write via save-dial).
 */
export class CreateAssemblyUseCase {
  constructor(
    private readonly repo: AssemblyRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateAssemblyCommand, orgId: OrgId): Promise<Result<Assembly, AppError>> {
    const now = this.clock.now();
    const id = asAssemblyId(cmd.id ?? this.ids.newId());
    if (cmd.id !== undefined) {
      const existing = await this.repo.findById(id);
      if (existing) return err(conflict("an assembly with this id already exists", "id"));
    }
    const created = Assembly.create({
      id,
      orgId,
      catalogKey: null,
      name: cmd.name,
      measurementBasis: cmd.measurementBasis,
      pricingMode: cmd.pricingMode,
      marginBps: cmd.marginBps,
      jobMinimumCents: cmd.jobMinimumCents,
      config: cmd.config as Assembly["props"]["config"], // validated inside create
      active: true,
      position: cmd.position ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    if (!created.ok) return err(created.error);
    return ok(await this.repo.create(created.value.props));
  }
}
