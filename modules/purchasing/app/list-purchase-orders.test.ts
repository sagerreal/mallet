import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, type OrgId } from "@mallet/shared/types";
import { PurchaseOrder, type POLineProps, type PurchaseOrderProps } from "../domain/purchase-order";
import type { PurchaseOrderRepository, PONoteRow } from "../domain/purchase-order-repository";
import { ListPurchaseOrdersUseCase } from "./list-purchase-orders";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

// Shared fake repository used by all purchasing app tests (via export), exactly as
// modules/settings/app/get-settings.test.ts exports FakeSettingsRepository.
//
// No persistence — an in-memory Map keyed by id, plus a Map of notes keyed by poId. `nextNumber()`
// hands out PO-1000, PO-1001, … from a counter and bumps `allocations` every time it is called, so
// a test can assert that a rejected place() burned nothing (see place-purchase-order.test.ts).
export class FakePurchaseOrderRepository implements PurchaseOrderRepository {
  private readonly store = new Map<string, PurchaseOrder>();
  private readonly notes = new Map<string, PONoteRow[]>();
  private seq = 1000;

  /** Every call to nextNumber(), successful or not — the thing place() must not burn on a refusal. */
  allocations = 0;

  /** Seed an arbitrary, already-built order (draft, ordered, or cancelled). */
  seed(po: PurchaseOrder): void {
    this.store.set(po.props.id, po);
  }

  /** Seed a fresh draft with `lineCount` placeholder lines. Returns the new id. */
  async seedDraft(opts: { vendor?: string; lineCount?: number; orgId?: OrgId } = {}): Promise<string> {
    const id = randomUUID();
    const lineCount = opts.lineCount ?? 1;
    const lines: POLineProps[] = Array.from({ length: lineCount }, (_, i) => ({
      id: randomUUID(),
      description: `Line ${i + 1}`,
      qty: 1,
      uom: "ea",
      unitCostMillicents: 100_000,
      position: i,
    }));
    const props: PurchaseOrderProps = {
      id,
      orgId: opts.orgId ?? ORG,
      num: null,
      vendor: opts.vendor ?? "Ferguson",
      status: "draft",
      jobId: null,
      orderedAt: null,
      expectedAt: null,
      shipTo: "counter_pickup",
      orderedByUserId: null,
      freightCents: 0,
      taxCents: 0,
      lines,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = PurchaseOrder.create(props);
    if (!isOk(r)) throw new Error(`seedDraft: invalid fixture — ${r.error.message}`);
    this.store.set(id, r.value);
    return id;
  }

  async list(): Promise<readonly PurchaseOrder[]> {
    // Mirrors DrizzlePurchaseOrderRepository.list()'s ORDER BY createdAt desc, id desc.
    return [...this.store.values()].sort((a, b) => {
      const byCreated = b.props.createdAt.getTime() - a.props.createdAt.getTime();
      return byCreated !== 0 ? byCreated : b.props.id.localeCompare(a.props.id);
    });
  }

  async findById(id: string): Promise<PurchaseOrder | null> {
    return this.store.get(id) ?? null;
  }

  async save(po: PurchaseOrder): Promise<void> {
    this.store.set(po.props.id, po);
  }

  async softDelete(id: string, _now: Date): Promise<number> {
    if (!this.store.has(id)) return 0;
    this.store.delete(id);
    return 1;
  }

  async nextNumber(): Promise<string> {
    this.allocations += 1;
    const n = this.seq;
    this.seq += 1;
    return `PO-${n}`;
  }

  async listNotes(poId: string): Promise<readonly PONoteRow[]> {
    return [...(this.notes.get(poId) ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async addNote(note: PONoteRow & { poId: string }): Promise<void> {
    const { poId, ...row } = note;
    const existing = this.notes.get(poId) ?? [];
    this.notes.set(poId, [...existing, row]);
  }
}

describe("ListPurchaseOrdersUseCase", () => {
  let repo: FakePurchaseOrderRepository;

  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("returns newest first", async () => {
    await repo.seedDraft({ vendor: "Older" });
    const older = [...(await repo.list())][0]!;
    // Force a distinct, earlier createdAt so ordering isn't accidentally correct by insertion order.
    const olderProps = { ...older.props, createdAt: new Date("2026-01-01T00:00:00Z") };
    const olderResult = PurchaseOrder.create(olderProps);
    if (!isOk(olderResult)) throw new Error("seed invalid");
    await repo.save(olderResult.value);

    const newerId = await repo.seedDraft({ vendor: "Newer" });
    const newer = await repo.findById(newerId);
    if (!newer) throw new Error("seed missing");
    const newerResult = PurchaseOrder.create({ ...newer.props, createdAt: new Date("2026-08-01T00:00:00Z") });
    if (!isOk(newerResult)) throw new Error("seed invalid");
    await repo.save(newerResult.value);

    const result = await new ListPurchaseOrdersUseCase(repo).exec();
    expect(result.map((po) => po.props.vendor)).toEqual(["Newer", "Older"]);
  });

  it("returns an empty list when there are no orders", async () => {
    const result = await new ListPurchaseOrdersUseCase(repo).exec();
    expect(result).toEqual([]);
  });
});
