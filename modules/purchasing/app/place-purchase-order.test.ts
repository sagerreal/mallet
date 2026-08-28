import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr } from "@mallet/shared/types";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { PlacePurchaseOrderUseCase } from "./place-purchase-order";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const OTHER_ORG = asOrgId("33333333-3333-3333-3333-333333333333");
const CLOCK = { now: () => new Date("2026-08-28T00:00:00Z") };

describe("PlacePurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("allocates the number at PLACE time, not at create — abandoned drafts burn none", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.num).toBe("PO-1000");
    expect(repo.allocations).toBe(1);
  });

  it("stamps status ordered and orderedAt from the clock", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("ordered");
      expect(r.value.props.orderedAt?.toISOString()).toBe(CLOCK.now().toISOString());
    }
  });

  it("persists the placed order", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    const found = await repo.findById(id);
    expect(found?.props.status).toBe("ordered");
  });

  it("refuses to place an order with no lines, and allocates no number doing so", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 0 });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isErr(r)).toBe(true);
    expect(repo.allocations).toBe(0);
  });

  it("refuses to re-place an already-ordered order, and allocates no number doing so", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(repo.allocations).toBe(1);

    const second = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isErr(second)).toBe(true);
    expect(repo.allocations).toBe(1); // unchanged — the second attempt burned nothing
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1, orgId: OTHER_ORG });
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, id);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
    expect(repo.allocations).toBe(0);
  });

  it("is a NOT_FOUND for an id that does not exist at all", async () => {
    const r = await new PlacePurchaseOrderUseCase(repo, CLOCK).exec(ORG, "00000000-0000-0000-0000-000000000000");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
