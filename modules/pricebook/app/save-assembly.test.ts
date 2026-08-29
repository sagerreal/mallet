/**
 * Saving an assembly to the pricebook, and updating the entry it came from.
 *
 * The three states the office sees — unsaved / synced / modified — all rest on these two
 * operations getting the SAME thing right: the entry's parts are exactly the quote's parts, in
 * the same order, and updating overwrites rather than accumulating.
 */
import { describe, it, expect } from "vitest";
import { asOrgId, asServiceId, isOk, type CursorPage, type OrgId, type Paginated, type ServiceId } from "@mallet/shared/types";
import { Service, type ServiceProps } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";
import type { ItemComponent } from "../domain/item-component";
import type { ItemComponentRepository } from "../domain/item-component-repository";
import { componentSignature } from "../domain/item-component";
import { SaveAssemblyUseCase, type SaveAssemblyCommand } from "./save-assembly";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-29T00:00:00Z");

const props = (over: Partial<ServiceProps> = {}): ServiceProps => ({
  id: asServiceId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "Cedar privacy fence",
  description: null,
  unitPriceCents: 1158,
  costCents: 0,
  laborHours: null,
  taxable: true,
  warrantyText: null,
  imageUrl: null,
  isAddon: false,
  active: true,
  position: 0,
  measuredBy: null,
  unit: "LF",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const service = (over: Partial<ServiceProps> = {}): Service => {
  const r = Service.create(props(over));
  if (!isOk(r)) throw new Error(JSON.stringify(r.error));
  return r.value;
};

class FakeServices implements ServiceRepository {
  readonly store = new Map<string, Service>();
  saved: Service[] = [];

  async create(input: Parameters<ServiceRepository["create"]>[0]): Promise<Service> {
    const made = service({
      id: asServiceId(input.id),
      name: input.name,
      unitPriceCents: input.unitPriceCents,
      costCents: input.costCents,
      taxable: input.taxable,
      categoryId: input.categoryId,
      unit: input.unit ?? null,
    });
    this.store.set(made.props.id, made);
    return made;
  }
  async findById(id: ServiceId): Promise<Service | null> {
    return this.store.get(id) ?? null;
  }
  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }
  async list(_page: CursorPage): Promise<Paginated<Service>> {
    return { items: [...this.store.values()], nextCursor: null };
  }
  async save(s: Service): Promise<void> {
    this.saved.push(s);
    this.store.set(s.props.id, s);
  }
  async archive(): Promise<number> {
    return 0;
  }
}

class FakeComponents implements ItemComponentRepository {
  readonly store = new Map<string, ItemComponent[]>();
  replaceCalls = 0;

  async replaceFor(itemId: string, components: readonly ItemComponent[]): Promise<void> {
    this.replaceCalls += 1;
    this.store.set(itemId, [...components]);
  }
  async listFor(itemId: string): Promise<ItemComponent[]> {
    return this.store.get(itemId) ?? [];
  }
  async listForMany(): Promise<Map<string, ItemComponent[]>> {
    return new Map(this.store);
  }
}

const seqIds = () => {
  let n = 0;
  return { newId: () => `id-${++n}` };
};

const useCase = (services = new FakeServices(), components = new FakeComponents()) => ({
  services,
  components,
  run: new SaveAssemblyUseCase(services, components, { now: () => NOW }, seqIds()),
});

const cmd = (over: Partial<SaveAssemblyCommand> = {}): SaveAssemblyCommand => ({
  orgId: ORG,
  name: "Cedar privacy fence",
  unit: "LF",
  unitPriceCents: 1158,
  components: [
    { description: "Line posts", unit: "ea", qtyExpr: "qty/8+1", roundUp: true, unitCostCents: 1800, unitPriceCents: 2430, markupBps: 3500 },
    { description: "Pickets", unit: "ea", qtyExpr: "qty*2", unitPriceCents: 415 },
  ],
  ...over,
});

describe("SaveAssemblyUseCase — saving a new entry", () => {
  it("mints a service that sells on its own, at the rate the assembly rolled up to", () => {
    // A shop that never opens the assembly again still has "Cedar privacy fence — $11.58 / LF".
    const { run, services } = useCase();
    return run.exec(cmd()).then((r) => {
      expect(isOk(r)).toBe(true);
      if (!isOk(r)) return;
      expect(r.value.service.props.name).toBe("Cedar privacy fence");
      expect(r.value.service.props.unitPriceCents).toBe(1158);
      expect(r.value.service.props.unit).toBe("LF");
      expect(services.store.size).toBe(1);
    });
  });

  it("stores the parts in the order they were handed over", async () => {
    const { run, components } = useCase();
    const r = await run.exec(cmd());
    if (!isOk(r)) throw new Error("expected a save");
    const stored = await components.listFor(r.value.service.props.id);
    expect(stored.map((c) => c.props.description)).toEqual(["Line posts", "Pickets"]);
    expect(stored.map((c) => c.props.position)).toEqual([0, 1]);
  });

  it("keeps the expression, not a count — the template has no driver", async () => {
    const { run } = useCase();
    const r = await run.exec(cmd());
    if (!isOk(r)) throw new Error("expected a save");
    expect(r.value.components[0]?.props.qtyExpr).toBe("qty/8+1");
    expect(r.value.components[0]?.props.roundUp).toBe(true);
  });

  it("refuses an assembly with no parts — that is just a service", async () => {
    const { run } = useCase();
    const r = await run.exec(cmd({ components: [] }));
    expect(isOk(r)).toBe(false);
  });

  it("refuses a part with nothing written on it rather than storing a blank row", async () => {
    const { run } = useCase();
    const r = await run.exec(cmd({ components: [{ description: "  ", unitPriceCents: 100 }] }));
    expect(isOk(r)).toBe(false);
  });
});

describe("SaveAssemblyUseCase — updating the entry a quote came from", () => {
  it("overwrites the entry's parts rather than accumulating them", async () => {
    const { run, services, components } = useCase();
    const first = await run.exec(cmd());
    if (!isOk(first)) throw new Error("expected a save");
    const itemId = first.value.service.props.id;

    const second = await run.exec(
      cmd({
        itemId,
        components: [{ description: "Line posts", unit: "ea", qtyExpr: "qty/6+1", unitPriceCents: 2430 }],
      }),
    );
    expect(isOk(second)).toBe(true);
    const stored = await components.listFor(itemId);
    expect(stored.map((c) => c.props.description)).toEqual(["Line posts"]);
    expect(stored[0]?.props.qtyExpr).toBe("qty/6+1");
    expect(services.store.size).toBe(1);
  });

  it("updates the entry's own price and name too", async () => {
    const { run, services } = useCase();
    const first = await run.exec(cmd());
    if (!isOk(first)) throw new Error("expected a save");
    const itemId = first.value.service.props.id;
    await run.exec(cmd({ itemId, name: "Cedar fence, 6ft", unitPriceCents: 1290 }));
    expect(services.store.get(itemId)?.props.name).toBe("Cedar fence, 6ft");
    expect(services.store.get(itemId)?.props.unitPriceCents).toBe(1290);
  });

  it("refuses to update an entry that is no longer there", async () => {
    // Quietly re-creating it would leave the quote pointing at an entry nobody made, and the
    // office believing they had updated something they had not.
    const { run } = useCase();
    const r = await run.exec(cmd({ itemId: "gone" }));
    expect(isOk(r)).toBe(false);
  });

  it("mints a SECOND entry when no id is given — that is Save as new", async () => {
    const { run, services } = useCase();
    await run.exec(cmd());
    await run.exec(cmd({ name: "Cedar fence, 8ft" }));
    expect(services.store.size).toBe(2);
  });
});

describe("SaveAssemblyUseCase — what the sync state reads", () => {
  it("round-trips to the same signature, so a saved assembly reads as synced", async () => {
    // Without this the office would see "Update in pricebook" on an entry they just saved.
    const { run, components } = useCase();
    const r = await run.exec(cmd());
    if (!isOk(r)) throw new Error("expected a save");
    const stored = await components.listFor(r.value.service.props.id);
    expect(componentSignature(stored)).toBe(componentSignature(r.value.components));
  });

  it("changes signature once a part changes, so it reads as modified", async () => {
    const { run } = useCase();
    const first = await run.exec(cmd());
    const second = await run.exec(
      cmd({ components: [{ description: "Line posts", unitPriceCents: 9999 }] }),
    );
    if (!isOk(first) || !isOk(second)) throw new Error("expected two saves");
    expect(componentSignature(first.value.components)).not.toBe(
      componentSignature(second.value.components),
    );
  });
});
