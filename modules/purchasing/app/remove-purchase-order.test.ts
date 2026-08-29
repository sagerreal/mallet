import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr, FixedClock, type OrgId } from "@mallet/shared/types";
import { PurchaseOrder, type PurchaseOrderProps } from "../domain/purchase-order";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { RemovePurchaseOrderUseCase } from "./remove-purchase-order";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const OTHER_ORG: OrgId = asOrgId("33333333-3333-3333-3333-333333333333");

const orderedProps = (overrides: Partial<PurchaseOrderProps> = {}): PurchaseOrderProps => ({
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  num: "PO-1000",
  vendor: "Ferguson",
  status: "ordered",
  jobId: null,
  orderedAt: new Date("2026-08-28T00:00:00Z"),
  expectedAt: null,
  shipTo: "counter_pickup",
  orderedByUserId: null,
  freightCents: 0,
  taxCents: 0,
  lines: [{ id: "l1", description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 }],
  createdAt: new Date("2026-08-28T00:00:00Z"),
  updatedAt: new Date("2026-08-28T00:00:00Z"),
  ...overrides,
});

const build = (props: PurchaseOrderProps): PurchaseOrder => {
  const r = PurchaseOrder.create(props);
  if (!isOk(r)) throw new Error(`fixture invalid: ${r.error.message}`);
  return r.value;
};

describe("RemovePurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
    clock = new FixedClock(new Date("2026-08-28T12:00:00Z"));
  });

  it("soft-deletes a draft", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson" });
    const r = await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, id);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.removed).toBe(true);
    expect(await repo.findById(id)).toBeNull();
  });

  it("refuses to remove a placed order, telling you to cancel it instead — the pair to cancel()'s draft refusal", async () => {
    repo.seed(build(orderedProps()));
    const r = await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, "11111111-1111-1111-1111-111111111111");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("conflict");
      expect(r.error.message).toMatch(/cancel/i);
    }
  });

  it("refuses to remove an already-cancelled order", async () => {
    repo.seed(build(orderedProps({ status: "cancelled" })));
    const r = await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, "11111111-1111-1111-1111-111111111111");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("conflict");
  });

  it("never hard-deletes: a refused removal leaves the order fully intact", async () => {
    repo.seed(build(orderedProps()));
    await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, "11111111-1111-1111-1111-111111111111");
    const still = await repo.findById("11111111-1111-1111-1111-111111111111");
    expect(still?.props.status).toBe("ordered");
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", orgId: OTHER_ORG });
    const r = await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, id);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });

  it("is a NOT_FOUND for an id that does not exist at all", async () => {
    const r = await new RemovePurchaseOrderUseCase(repo, clock).exec(ORG, "99999999-9999-9999-9999-999999999999");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
