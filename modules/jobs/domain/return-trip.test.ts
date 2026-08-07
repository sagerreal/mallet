import { describe, it, expect } from "vitest";
import { decideReturnTrip, type JobBillSummary } from "./return-trip";

const bill = (over: Partial<JobBillSummary> = {}): JobBillSummary => ({
  num: "INV-1",
  status: "draft",
  amountPaidCents: 0,
  ...over,
});

describe("decideReturnTrip — an open job is untouched", () => {
  it("allows a scheduled job without reopening anything", () => {
    expect(decideReturnTrip("scheduled", null)).toEqual({
      allowed: true,
      reopens: false,
      billIsStale: false,
    });
  });

  it("allows an in-progress job even when its bill is already paid", () => {
    // Nothing is being reopened, so no money is being disturbed. The paid-bill rule exists to
    // guard the REOPEN; applying it to a job that never closed would block a return trip on a
    // deposit-billed job for no reason.
    expect(decideReturnTrip("in_progress", bill({ status: "paid", amountPaidCents: 40_000 }))).toEqual({
      allowed: true,
      reopens: false,
      billIsStale: false,
    });
  });
});

describe("decideReturnTrip — THE MONEY RULE", () => {
  it("refuses a finished job whose bill is PAID", () => {
    expect(decideReturnTrip("complete", bill({ status: "paid", amountPaidCents: 40_000 }))).toEqual({
      allowed: false,
      refusal: "money_taken",
    });
  });

  it("refuses a finished job whose bill is PART paid", () => {
    expect(
      decideReturnTrip("complete", bill({ status: "partial", amountPaidCents: 15_000 })),
    ).toEqual({ allowed: false, refusal: "money_taken" });
  });

  it("refuses on money in the ledger even when the status column disagrees", () => {
    // The status column is denormalized; the cents are the fact. A row that carries a payment and
    // still reads 'sent' (a write that half-landed) must refuse for the money, not for the send.
    expect(decideReturnTrip("complete", bill({ status: "sent", amountPaidCents: 1 }))).toEqual({
      allowed: false,
      refusal: "money_taken",
    });
  });

  it("refuses a finished job whose bill is already with the customer", () => {
    expect(decideReturnTrip("complete", bill({ status: "sent" }))).toEqual({
      allowed: false,
      refusal: "bill_out",
    });
  });

  it("refuses a finished job whose bill was voided", () => {
    // A void bill still holds the job's one invoices_org_source_job_uidx slot and cannot be
    // edited, so work added after a reopen could never be billed at all.
    expect(decideReturnTrip("complete", bill({ status: "void" }))).toEqual({
      allowed: false,
      refusal: "bill_void",
    });
  });

  it("refuses a canceled job outright — the domain has no un-cancel", () => {
    expect(decideReturnTrip("canceled", null)).toEqual({
      allowed: false,
      refusal: "job_canceled",
    });
  });
});

describe("decideReturnTrip — when nothing has been taken", () => {
  it("allows a finished job with no bill at all, and reopens it", () => {
    expect(decideReturnTrip("complete", null)).toEqual({
      allowed: true,
      reopens: true,
      billIsStale: false,
    });
  });

  it("allows a finished job with an untouched draft, and flags the draft as stale", () => {
    // createFromJob is idempotent on source_job_id, so this draft will NOT pick up the work the
    // return trip adds. Allowed, but never silently: the caller carries the fact onward.
    expect(decideReturnTrip("complete", bill({ status: "draft" }))).toEqual({
      allowed: true,
      reopens: true,
      billIsStale: true,
    });
  });
});
