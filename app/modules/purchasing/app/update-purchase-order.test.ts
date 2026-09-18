import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, isOk, isErr, FixedClock, type OrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { PurchaseOrder, type PurchaseOrderProps } from "../domain/purchase-order";
import { FakePurchaseOrderRepository } from "./list-purchase-orders.test";
import { UpdatePurchaseOrderUseCase, type UpdatePurchaseOrderCommand } from "./update-purchase-order";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const OTHER_ORG: OrgId = asOrgId("33333333-3333-3333-3333-333333333333");
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

const orderedProps = (overrides: Partial<PurchaseOrderProps> = {}): PurchaseOrderProps => ({
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  num: "PO-1000",
  vendor: "Ferguson",
  status: "ordered",
  jobId: null,
  orderedAt: new Date("2026-08-01T00:00:00Z"),
  expectedAt: null,
  shipToAddress: null,
  orderedByUserId: null,
  freightCents: 0,
  taxCents: 0,
  lines: [{ id: "l1", description: "PEX coil", qty: 4, uom: "coil", unitCostMillicents: 8_640_000, position: 0 }],
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  ...overrides,
});

const build = (props: PurchaseOrderProps): PurchaseOrder => {
  const r = PurchaseOrder.create(props);
  if (!isOk(r)) throw new Error(`fixture invalid: ${r.error.message}`);
  return r.value;
};

describe("UpdatePurchaseOrderUseCase", () => {
  let repo: FakePurchaseOrderRepository;
  beforeEach(() => {
    repo = new FakePurchaseOrderRepository();
  });

  it("edits header fields on a draft", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: UpdatePurchaseOrderCommand = { poId: id, vendor: "Winsupply", freightCents: 1_200 };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.vendor).toBe("Winsupply");
      expect(r.value.props.freightCents).toBe(1_200);
    }
  });

  it("edits lines on a draft", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: UpdatePurchaseOrderCommand = {
      poId: id,
      lines: [{ description: "Brass valve", qty: 2, uom: "ea", unitCostMillicents: 1_810_000 }],
    };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.lines).toHaveLength(1);
      expect(r.value.props.lines[0]?.description).toBe("Brass valve");
    }
  });

  it(
    "refuses to edit lines on a placed order — reconciling a bill by editing what you ordered erases the variance",
    async () => {
      repo.seed(build(orderedProps()));
      const cmd: UpdatePurchaseOrderCommand = {
        poId: "11111111-1111-1111-1111-111111111111",
        lines: [{ description: "Substituted part", qty: 1, uom: "ea", unitCostMillicents: 500_000 }],
      };
      const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.message).toMatch(/variance/i);

      // The original lines were never touched.
      const found = await repo.findById("11111111-1111-1111-1111-111111111111");
      expect(found?.props.lines[0]?.description).toBe("PEX coil");
    },
  );

  it("still allows header edits on a placed order — freight quoted late isn't a promise to the vendor", async () => {
    repo.seed(build(orderedProps()));
    const cmd: UpdatePurchaseOrderCommand = { poId: "11111111-1111-1111-1111-111111111111", freightCents: 4_200 };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.freightCents).toBe(4_200);
      expect(r.value.props.lines[0]?.description).toBe("PEX coil");
    }
  });

  it("refuses any edit on a cancelled order", async () => {
    repo.seed(build(orderedProps({ status: "cancelled" })));
    const cmd: UpdatePurchaseOrderCommand = { poId: "11111111-1111-1111-1111-111111111111", vendor: "Winsupply" };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isErr(r)).toBe(true);
  });

  it("rejects a blank vendor", async () => {
    const id = await repo.seedDraft({ vendor: "Ferguson", lineCount: 1 });
    const cmd: UpdatePurchaseOrderCommand = { poId: id, vendor: "   " };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isErr(r)).toBe(true);
  });

  it("is a NOT_FOUND for an id in another org", async () => {
    repo.seed(build(orderedProps({ orgId: OTHER_ORG })));
    const cmd: UpdatePurchaseOrderCommand = { poId: "11111111-1111-1111-1111-111111111111", vendor: "Winsupply" };
    const r = await new UpdatePurchaseOrderUseCase(repo, CLOCK, seqIds()).exec(ORG, cmd);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("not_found");
  });
});
