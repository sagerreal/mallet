import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  money,
  zeroMoney,
  ok,
  err,
  externalService,
  isOk,
  type OrgId,
  type LeadId,
  type InvoiceId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type {
  TerminalGateway,
  CreateTapIntentCmd,
  CreateTerminalLocationCmd,
  CreateConnectionTokenCmd,
} from "../domain/terminal-gateway";
import type { TerminalLocationStore } from "../domain/terminal-location-store";
import { CreateTerminalConnectionTokenUseCase } from "./terminal-connection-token";
import { EnsureTerminalLocationUseCase } from "./ensure-terminal-location";
import { CreateTapPaymentIntentUseCase } from "./create-tap-payment-intent";

const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-4333-8333-333333333333");
const INV = "11111111-1111-4111-8111-111111111111";

const invoice = (overrides: Partial<Parameters<typeof Invoice.create>[0]> = {}): Invoice => {
  const r = Invoice.create({
    id: asInvoiceId(INV),
    orgId: ORG,
    num: "INV-1000",
    sourceJobId: null,
    leadId: LEAD,
    title: "Job",
    status: "sent",
    total: money(100_000),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines: [],
    termsDays: 7,
    sentAt: new Date("2026-06-01T00:00:00Z"),
    dueAt: new Date("2026-06-08T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// Minimal fake supporting only what these use-cases touch (findById).
class FakeRepo implements InvoiceRepository {
  constructor(public current: Invoice | null) {}
  async findById(): Promise<Invoice | null> {
    return this.current;
  }
  async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment): Promise<boolean> {
    return true;
  }
  async applyPayment(): Promise<ApplyResult> {
    return { applied: false, invoice: this.current };
  }
  async nextNumber(): Promise<string> {
    return "INV-1";
  }
  async save(): Promise<void> {}
  async insertNew(): Promise<boolean> {
    return true;
  }
  async insertForJob(): Promise<boolean> {
    return true;
  }
  async findByPublicToken(): Promise<Invoice | null> {
    return null;
  }
  async listByScopeJob() {
    return [];
  }
  async findBySourceJob(): Promise<Invoice | null> {
    return null;
  }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> {
    return 0;
  }
  async list(_p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async listByLead(): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async findOverdue(): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
}

const okConnect: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: "acct_test", chargesEnabled: true }),
};
const notOnboarded: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: null, chargesEnabled: false }),
};
const chargesDisabled: ConnectTargetReader = {
  read: async () => ({ connectedAccountId: "acct_test", chargesEnabled: false }),
};

/** A gateway whose calls are captured; every call succeeds unless a specific fake overrides it. */
const capturingGateway = () => {
  const tokenCalls: CreateConnectionTokenCmd[] = [];
  const locationCalls: CreateTerminalLocationCmd[] = [];
  const intentCalls: CreateTapIntentCmd[] = [];
  const gateway: TerminalGateway = {
    createConnectionToken: async (cmd) => {
      tokenCalls.push(cmd);
      return ok({ secret: "pst_test_secret" });
    },
    createLocation: async (cmd) => {
      locationCalls.push(cmd);
      return ok({ locationId: "tml_test1" });
    },
    createTapPaymentIntent: async (cmd) => {
      intentCalls.push(cmd);
      return ok({ paymentIntentId: "pi_tap00001", clientSecret: "pi_tap00001_secret_x" });
    },
    retrieveTapPaymentIntent: async () => {
      throw new Error("not under test here");
    },
  };
  return { gateway, tokenCalls, locationCalls, intentCalls };
};

const failingGateway: TerminalGateway = {
  createConnectionToken: async () => err(externalService("stripe", "down", true)),
  createLocation: async () => err(externalService("stripe", "down", true)),
  createTapPaymentIntent: async () => err(externalService("stripe", "down", true)),
  retrieveTapPaymentIntent: async () => err(externalService("stripe", "down", true)),
};

/** In-memory location store: starts empty (or seeded) and remembers what was saved. */
class FakeLocationStore implements TerminalLocationStore {
  public saved: string[] = [];
  constructor(
    private locationId: string | null = null,
    private readonly profile = { displayName: "Summit Plumbing", addressLine1: "1 Main St" as string | null },
  ) {}
  async read(): Promise<string | null> {
    return this.locationId;
  }
  async save(locationId: string): Promise<void> {
    this.saved.push(locationId);
    this.locationId = locationId;
  }
  async businessProfile(): Promise<{ displayName: string; addressLine1: string | null }> {
    return this.profile;
  }
}

describe("CreateTerminalConnectionTokenUseCase", () => {
  it("mints a connection token on the shop's connected account, scoped to the stored location", async () => {
    const { gateway, tokenCalls } = capturingGateway();
    const uc = new CreateTerminalConnectionTokenUseCase(gateway, okConnect, new FakeLocationStore("tml_existing"));
    const r = await uc.exec();
    expect(isOk(r) && r.value.secret).toBe("pst_test_secret");
    expect(tokenCalls).toEqual([{ connectedAccountId: "acct_test", locationId: "tml_existing" }]);
  });

  it("passes a null location when none is stored yet — the token then works for any reader", async () => {
    const { gateway, tokenCalls } = capturingGateway();
    const r = await new CreateTerminalConnectionTokenUseCase(gateway, okConnect, new FakeLocationStore()).exec();
    expect(isOk(r)).toBe(true);
    expect(tokenCalls[0]?.locationId).toBeNull();
  });

  it("refuses (precondition) when the shop never onboarded, without calling Stripe", async () => {
    const { gateway, tokenCalls } = capturingGateway();
    const r = await new CreateTerminalConnectionTokenUseCase(gateway, notOnboarded, new FakeLocationStore()).exec();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("precondition");
    expect(tokenCalls).toHaveLength(0);
  });

  it("refuses (precondition) when charges are not yet enabled on the connected account", async () => {
    const r = await new CreateTerminalConnectionTokenUseCase(
      capturingGateway().gateway,
      chargesDisabled,
      new FakeLocationStore(),
    ).exec();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("precondition");
  });

  it("propagates a gateway failure as external_service", async () => {
    const r = await new CreateTerminalConnectionTokenUseCase(failingGateway, okConnect, new FakeLocationStore()).exec();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
  });
});

describe("EnsureTerminalLocationUseCase", () => {
  it("returns the stored location without calling Stripe when one exists (create-once)", async () => {
    const { gateway, locationCalls } = capturingGateway();
    const store = new FakeLocationStore("tml_existing");
    const r = await new EnsureTerminalLocationUseCase(gateway, okConnect, store).exec({ orgId: ORG });
    expect(isOk(r) && r.value.locationId).toBe("tml_existing");
    expect(locationCalls).toHaveLength(0);
    expect(store.saved).toHaveLength(0);
  });

  it("creates the location on the connected account from the shop's own profile and stores it", async () => {
    const { gateway, locationCalls } = capturingGateway();
    const store = new FakeLocationStore(null);
    const r = await new EnsureTerminalLocationUseCase(gateway, okConnect, store).exec({ orgId: ORG });
    expect(isOk(r) && r.value.locationId).toBe("tml_test1");
    expect(store.saved).toEqual(["tml_test1"]);
    const cmd = locationCalls[0];
    expect(cmd?.connectedAccountId).toBe("acct_test");
    expect(cmd?.displayName).toBe("Summit Plumbing");
    expect(cmd?.addressLine1).toBe("1 Main St");
    // Stable per (org, account): a retry after a failed save returns the SAME Stripe location.
    expect(cmd?.idempotencyKey).toBe(`tml:${ORG}:acct_test`);
  });

  it("refuses (precondition) when the shop has no charges-enabled Connect account", async () => {
    const { gateway, locationCalls } = capturingGateway();
    const r = await new EnsureTerminalLocationUseCase(gateway, notOnboarded, new FakeLocationStore(null)).exec({
      orgId: ORG,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("precondition");
    expect(locationCalls).toHaveLength(0);
  });

  it("does not store anything when the Stripe create fails", async () => {
    const store = new FakeLocationStore(null);
    const r = await new EnsureTerminalLocationUseCase(failingGateway, okConnect, store).exec({ orgId: ORG });
    expect(r.ok).toBe(false);
    expect(store.saved).toHaveLength(0);
  });
});

describe("CreateTapPaymentIntentUseCase", () => {
  const exec = (repo: InvoiceRepository, gateway: TerminalGateway, connect: ConnectTargetReader = okConnect) =>
    new CreateTapPaymentIntentUseCase(repo, gateway, connect).exec({ orgId: ORG, invoiceId: asInvoiceId(INV) });

  it("mints a card_present intent for the FULL balance with the 0.25% platform fee", async () => {
    const { gateway, intentCalls } = capturingGateway();
    const r = await exec(new FakeRepo(invoice()), gateway);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.paymentIntentId).toBe("pi_tap00001");
      expect(r.value.clientSecret).toBe("pi_tap00001_secret_x");
      expect(r.value.amountCents).toBe(100_000);
    }
    const cmd = intentCalls[0];
    expect(cmd?.connectedAccountId).toBe("acct_test");
    expect(cmd?.amountCents).toBe(100_000);
    expect(cmd?.applicationFeeCents).toBe(250); // 0.25% of $1,000.00
    expect(cmd?.invoiceId).toBe(INV);
    expect(cmd?.orgId).toBe(ORG);
  });

  it("charges the remaining balance on a partial invoice, not the total", async () => {
    const { gateway, intentCalls } = capturingGateway();
    const r = await exec(new FakeRepo(invoice({ status: "partial", amountPaid: money(60_000) })), gateway);
    expect(isOk(r) && r.value.amountCents).toBe(40_000);
    expect(intentCalls[0]?.amountCents).toBe(40_000);
  });

  it("rejects a missing invoice (not_found) and a draft invoice (conflict)", async () => {
    const { gateway } = capturingGateway();
    const missing = await exec(new FakeRepo(null), gateway);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not_found");
    const draft = await exec(new FakeRepo(invoice({ status: "draft" })), gateway);
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.error.kind).toBe("conflict");
  });

  it("rejects a sub-minimum balance (below Stripe's $0.50 card minimum) without calling the gateway", async () => {
    const { gateway, intentCalls } = capturingGateway();
    const r = await exec(new FakeRepo(invoice({ status: "partial", amountPaid: money(99_970) })), gateway);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(intentCalls).toHaveLength(0);
  });

  it("refuses (precondition) when the shop has no charges-enabled Connect account, without calling Stripe", async () => {
    const { gateway, intentCalls } = capturingGateway();
    const r = await exec(new FakeRepo(invoice()), gateway, notOnboarded);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("precondition");
    expect(intentCalls).toHaveLength(0);
    const disabled = await exec(new FakeRepo(invoice()), capturingGateway().gateway, chargesDisabled);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error.kind).toBe("precondition");
  });

  it("propagates a gateway failure as external_service", async () => {
    const r = await exec(new FakeRepo(invoice()), failingGateway);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
  });
});
