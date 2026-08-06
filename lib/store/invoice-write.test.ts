/**
 * lib/store/invoice-write.test.ts
 * The endpoint picker is the ONE place that decides whether a money write lands on the office
 * router or the field one, so it is the one place worth pinning down exactly.
 *
 * Two properties, and they are the whole point of the module existing:
 *   1. `surface: "field"` NEVER touches `v1.invoicing.*`. Every one of those procedures is
 *      ownerOrOffice, so a leak there is a FORBIDDEN in front of a paying customer.
 *   2. `raiseVisitFee` sends the JOB ID AND NOTHING ELSE. Not an invoice id — the server's guard
 *      authorizes the job and can say nothing about an id, so a caller-supplied one would be an
 *      unchecked write target ("raise a fee on my own job, into THAT invoice"). Not an amount —
 *      it comes from the shop's settings, so the tablet cannot choose what the customer is
 *      charged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const office = {
  createFromJob: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  recordPayment: vi.fn(),
  createPayment: vi.fn(),
};
const field = {
  createFromJob: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  recordPayment: vi.fn(),
  createPayment: vi.fn(),
  raiseVisitFee: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      invoicing: {
        createFromJob: { mutate: (a: unknown) => office.createFromJob(a) },
        get: { query: (a: unknown) => office.get(a) },
        send: { mutate: (a: unknown) => office.send(a) },
        recordPayment: { mutate: (a: unknown) => office.recordPayment(a) },
        createPayment: { mutate: (a: unknown) => office.createPayment(a) },
      },
      fieldInvoicing: {
        createFromJob: { mutate: (a: unknown) => field.createFromJob(a) },
        get: { query: (a: unknown) => field.get(a) },
        send: { mutate: (a: unknown) => field.send(a) },
        recordPayment: { mutate: (a: unknown) => field.recordPayment(a) },
        createPayment: { mutate: (a: unknown) => field.createPayment(a) },
        raiseVisitFee: { mutate: (a: unknown) => field.raiseVisitFee(a) },
      },
    },
  },
}));

import {
  mintCheckoutSession,
  persistInvoiceFromJob,
  persistRecordPayment,
  persistSendInvoice,
  raiseVisitFee,
  readInvoice,
} from "./invoice-write";
import type { Invoice } from "./types";

const prior: Invoice = {
  id: "inv-1", num: "INV-800", jobId: "job-1", leadId: "lead-1",
  cust: "Dana Alvarez", phone: "+15550001234", email: "dana@x.com", title: "Water heater",
  lines: [], total: 840, depPaid: 0, payments: [], status: "sent", age: 0,
  archived: false, origin: "db",
};

/** The office wire shape — carries cost, taxBps, the pay-link token. */
const officeDTO = {
  id: "inv-1", num: "INV-800", sourceJobId: "job-1", leadId: "lead-1", title: "Water heater",
  status: "sent", total: { cents: 84_000, currency: "USD" }, taxBps: 0,
  tax: { cents: 0, currency: "USD" }, discBps: 0, discount: { cents: 0, currency: "USD" },
  depositPaid: { cents: 0, currency: "USD" },
  termsDays: 7, lines: [], payments: [], createdAt: "2026-08-01T12:00:00.000Z",
  dueAt: null, followUpOn: false, followUpStage: 0,
};

/** The field wire shape — a separate, smaller type. No cost, no token, balance always present. */
const fieldDTO = {
  id: "inv-2", num: "INV-900", sourceJobId: null, scopeJobId: "job-1", leadId: "lead-1",
  customerName: "Dana Alvarez", title: "Visit fee — service call", status: "draft",
  total: { cents: 8_900, currency: "USD" }, tax: { cents: 0, currency: "USD" },
  discount: { cents: 0, currency: "USD" },
  depositPaid: { cents: 0, currency: "USD" }, amountPaid: { cents: 0, currency: "USD" },
  due: { cents: 8_900, currency: "USD" }, termsDays: 0, lines: [], payments: [],
  sentAt: null, dueAt: null, createdAt: "2026-08-01T12:00:00.000Z",
};

beforeEach(() => {
  for (const fn of [...Object.values(office), ...Object.values(field)]) fn.mockReset();
  for (const fn of Object.values(office)) fn.mockResolvedValue(officeDTO);
  for (const fn of Object.values(field)) fn.mockResolvedValue(fieldDTO);
  office.createPayment.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/office" });
  field.createPayment.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/field" });
});

describe("invoice-write — the office surface reaches only v1.invoicing.*", () => {
  it("routes every write to the desk's router", async () => {
    await persistInvoiceFromJob("office", { jobId: "job-1", id: "inv-1" }, prior);
    await readInvoice("office", "inv-1", prior);
    await persistSendInvoice("office", "inv-1", prior);
    await persistRecordPayment(
      "office",
      { invoiceId: "inv-1", amountCents: 84_000, method: "cash", idempotencyKey: "k-12345678" },
      prior,
    );
    await mintCheckoutSession("office", "inv-1");

    for (const fn of Object.values(office)) expect(fn).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(field)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("invoice-write — the field surface NEVER reaches an office procedure", () => {
  it("routes every write to the job-authorized router", async () => {
    await persistInvoiceFromJob("field", { jobId: "job-1", id: "inv-1" }, prior);
    await readInvoice("field", "inv-1", prior);
    await persistSendInvoice("field", "inv-1", prior);
    await persistRecordPayment(
      "field",
      { invoiceId: "inv-1", amountCents: 84_000, method: "cash", idempotencyKey: "k-12345678" },
      prior,
    );
    await mintCheckoutSession("field", "inv-1");

    for (const fn of Object.values(office)) expect(fn).not.toHaveBeenCalled();
    expect(field.createFromJob).toHaveBeenCalledTimes(1);
    expect(field.get).toHaveBeenCalledTimes(1);
    expect(field.send).toHaveBeenCalledTimes(1);
    expect(field.recordPayment).toHaveBeenCalledTimes(1);
    expect(field.createPayment).toHaveBeenCalledTimes(1);
    // …and the fee is not raised as a side effect of anything else.
    expect(field.raiseVisitFee).not.toHaveBeenCalled();
  });

  it("maps the FIELD wire shape, not the office one (the two are different types)", async () => {
    const record = await readInvoice("field", "inv-2", prior);
    // The field DTO's `scopeJobId` is deliberately NOT folded into the store's jobId: that is
    // the job which AUTHORIZES the fee, not the job whose bill it is.
    expect(record.jobId).toBeNull();
    expect(record.total).toBe(89);
    expect(record.due).toBe(89);
    expect(record.cust).toBe("Dana Alvarez");
  });
});

describe("invoice-write — raiseVisitFee carries the jobId and nothing else", () => {
  it("sends exactly { jobId } — no invoice id, no amount", async () => {
    await raiseVisitFee("job-1");
    expect(field.raiseVisitFee).toHaveBeenCalledTimes(1);
    const [input] = field.raiseVisitFee.mock.calls[0] as [Record<string, unknown>];
    expect(input).toEqual({ jobId: "job-1" });
    expect(Object.keys(input)).toEqual(["jobId"]);
  });

  it("has no office variant at all — one anyRole path for both roles", async () => {
    await raiseVisitFee("job-1");
    for (const fn of Object.values(office)) expect(fn).not.toHaveBeenCalled();
  });

  it("adopts the returned invoice with no prior record on this device", async () => {
    const record = await raiseVisitFee("job-1");
    expect(record.id).toBe("inv-2");
    expect(record.title).toBe("Visit fee — service call");
    expect(record.total).toBe(89);
    expect(record.origin).toBe("db");
    // A technician's store holds no invoices, so the mapper must survive having no prior.
    expect(record.cust).toBe("Dana Alvarez");
    expect(record.phone).toBe("");
  });

  // The prior is a LOOKUP, not a record: the raise is idempotent per job, so the caller cannot
  // know which invoice it resolves until the answer lands. An OFFICE caller resuming a fee it
  // already holds must not lose the customer's phone to the field shape, which does not carry one.
  it("asks for the prior by the id the SERVER returned, not one the caller guessed", async () => {
    const priorFor = vi.fn(() => ({ ...prior, id: "inv-2", phone: "+15550009999" }));
    const record = await raiseVisitFee("job-1", priorFor);
    expect(priorFor).toHaveBeenCalledWith("inv-2");
    expect(record.phone).toBe("+15550009999");
  });
});
