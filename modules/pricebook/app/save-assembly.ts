/**
 * Save an assembly from a quote into the pricebook, or update the entry it came from.
 *
 * "Save to pricebook" and "Save as new" are the same operation — a fresh entry, and the quote
 * re-points at it. "Update in pricebook" overwrites the entry the quote already names. The
 * office decides which; the difference is entirely whether an id came in, so there is one use
 * case and not three.
 *
 * The parent lands as an ordinary Service, priced per unit at whatever the assembly rolled up
 * to. That is deliberate: a shop that never opens the assembly again still has a sellable
 * "Cedar privacy fence — $11.58 / LF" in their book, and it prices the same as it did on the
 * quote it came from.
 */
import type { Result, AppError, Clock, OrgId } from "@mallet/shared/types";
import { validation, notFound, ok, err, isOk, asServiceId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { ItemComponent } from "../domain/item-component";
import type { ItemComponentRepository } from "../domain/item-component-repository";
import type { Service } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";

export interface AssemblyComponentInput {
  readonly description: string;
  readonly unit?: string | null;
  readonly qtyExpr?: string | null;
  readonly roundUp?: boolean;
  readonly unitCostCents?: number;
  readonly unitPriceCents: number;
  readonly markupBps?: number | null;
}

export interface SaveAssemblyCommand {
  readonly orgId: OrgId;
  /** The entry to overwrite. Absent mints a new one — that is "Save as new". */
  readonly itemId?: string | null;
  readonly name: string;
  /** What the assembly's price is per ("LF"). */
  readonly unit?: string | null;
  /** The rolled-up rate, so the entry sells on its own without opening it. */
  readonly unitPriceCents: number;
  readonly costCents?: number;
  readonly categoryId?: string | null;
  readonly taxable?: boolean;
  readonly components: readonly AssemblyComponentInput[];
}

export interface SavedAssembly {
  readonly service: Service;
  readonly components: readonly ItemComponent[];
}

export class SaveAssemblyUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly components: ItemComponentRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SaveAssemblyCommand): Promise<Result<SavedAssembly, AppError>> {
    if (cmd.components.length === 0) {
      // An assembly with no parts is just a service, and the book already has a way to save one.
      return err(validation("an assembly needs at least one part", "components"));
    }
    const built = this.buildComponents(cmd.components);
    if (!isOk(built)) return built;

    const now = this.clock.now();
    const service = cmd.itemId
      ? await this.overwrite(cmd, cmd.itemId, now)
      : await this.mint(cmd);
    if (!isOk(service)) return service;

    await this.components.replaceFor(service.value.props.id, built.value, now);
    return ok({ service: service.value, components: built.value });
  }

  /** A brand-new entry. */
  private async mint(cmd: SaveAssemblyCommand): Promise<Result<Service, AppError>> {
    const created = await this.services.create({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      categoryId: cmd.categoryId ?? null,
      code: null,
      name: cmd.name.trim(),
      description: null,
      unitPriceCents: cmd.unitPriceCents,
      costCents: cmd.costCents ?? 0,
      laborHours: null,
      taxable: cmd.taxable ?? true,
      warrantyText: null,
      imageUrl: null,
      isAddon: false,
      active: true,
      position: 0,
      measuredBy: null,
      unit: cmd.unit ?? null,
    });
    return ok(created);
  }

  /**
   * Overwrite the entry the quote names. A missing one is NOT quietly re-created: the quote
   * would then point at an entry nobody deliberately made, and the office would think they had
   * updated something they had not.
   */
  private async overwrite(
    cmd: SaveAssemblyCommand,
    itemId: string,
    now: Date,
  ): Promise<Result<Service, AppError>> {
    const existing = await this.services.findById(asServiceId(itemId));
    if (!existing) return err(notFound("that pricebook entry no longer exists"));
    const updated = existing.patch(
      {
        name: cmd.name.trim(),
        unitPriceCents: cmd.unitPriceCents,
        costCents: cmd.costCents ?? 0,
        unit: cmd.unit ?? null,
        ...(cmd.categoryId === undefined ? {} : { categoryId: cmd.categoryId }),
        ...(cmd.taxable === undefined ? {} : { taxable: cmd.taxable }),
      },
      now,
    );
    if (!isOk(updated)) return updated;
    await this.services.save(updated.value);
    return ok(updated.value);
  }

  /** Position is the order they were handed over in — the order the office typed them. */
  private buildComponents(
    inputs: readonly AssemblyComponentInput[],
  ): Result<ItemComponent[], AppError> {
    const built: ItemComponent[] = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      if (!input) continue;
      const component = ItemComponent.create({
        id: this.ids.newId(),
        description: input.description,
        unit: input.unit ?? null,
        qtyExpr: input.qtyExpr ?? null,
        roundUp: input.roundUp ?? false,
        unitCostCents: input.unitCostCents ?? 0,
        unitPriceCents: input.unitPriceCents,
        markupBps: input.markupBps ?? null,
        position: i,
      });
      if (!isOk(component)) return component;
      built.push(component.value);
    }
    return ok(built);
  }
}
