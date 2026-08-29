import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr, FixedClock, type OrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { CreatePurchaseOrderUseCase, type CreatePurchaseOrderCommand } from "./create-purchase-order";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CLOCK = new FixedClock(new Date("2026-08-28T00:00:00Z"));

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

const baseCmd = (overrides: Partial<CreatePurchaseOrderCommand> = {}): CreatePurchaseOrderCommand => ({
  vendor: "Ferguson",
  jobId: null,
  expectedAt: null,
  shipToAddress: null,
  orderedByUserId: null,
  ...overrides,
});

describe("CreatePurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;

  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("rejects a blank vendor", async () => {
    const r = await new CreatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, baseCmd({ vendor: "   " }));
    expect(isErr(r)).toBe(true);
  });

  it("accepts a null job — a stock/truck-restock order has no job", async () => {
    const r = await new CreatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, baseCmd({ jobId: null }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.jobId).toBeNull();
  });

  it("mints a draft with no number — allocating one is place()'s job alone", async () => {
    const r = await new CreatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, baseCmd());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("draft");
      expect(r.value.props.num).toBeNull();
    }
    expect(repo.allocations).toBe(0);
  });

  it("persists the order so a later findById sees it", async () => {
    const r = await new CreatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, baseCmd());
    if (!isOk(r)) throw new Error("expected ok");
    const found = await repo.findById(r.value.props.id);
    expect(found?.props.vendor).toBe("Ferguson");
  });

  it("builds lines with sequential positions and minted ids", async () => {
    const r = await new CreatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(
      ORG,
      baseCmd({
        lines: [
          { description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000 },
          { description: "Brass valve", qty: 12, uom: "ea", unitCostMillicents: 1_810_000 },
        ],
      }),
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.lines.map((l) => l.position)).toEqual([0, 1]);
      expect(new Set(r.value.props.lines.map((l) => l.id)).size).toBe(2);
    }
  });
});
