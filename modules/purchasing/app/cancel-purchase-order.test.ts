import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr, type OrgId } from "@mallet/shared/types";
import { PurchaseOrder, type PurchaseOrderProps } from "../domain/purchase-order";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { CancelPurchaseOrderUseCase } from "./cancel-purchase-order";

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

describe("CancelPurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("cancels an ordered order", async () => {
    repo.seed(build(orderedProps()));
    const r = await new CancelPurchaseOrderUseCase(repo).exec(ORG, "11111111-1111-1111-1111-111111111111");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.status).toBe("cancelled");
  });

  it("a cancelled order contributes nothing to job cost", async () => {
    repo.seed(build(orderedProps()));
    const r = await new CancelPurchaseOrderUseCase(repo).exec(ORG, "11111111-1111-1111-1111-111111111111");
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.jobCostCents()).toBe(0);
  });

  it("refuses to cancel a draft, telling you to delete it instead", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const r = await new CancelPurchaseOrderUseCase(repo).exec(ORG, id);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toMatch(/delete/i);
  });

  it("refuses to cancel an already-cancelled order", async () => {
    repo.seed(build(orderedProps({ status: "cancelled" })));
    const r = await new CancelPurchaseOrderUseCase(repo).exec(ORG, "11111111-1111-1111-1111-111111111111");
    expect(isErr(r)).toBe(true);
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    repo.seed(build(orderedProps({ orgId: OTHER_ORG })));
    const r = await new CancelPurchaseOrderUseCase(repo).exec(ORG, "11111111-1111-1111-1111-111111111111");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
