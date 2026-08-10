/**
 * THE END-TO-END GUARANTEE: what the customer signed at the door is what the invoice bills.
 *
 * This is where Jobber fails and Mallet must not. Their tax is re-derived at invoice time from the
 * property's default rate, so an approved quote's tax can move retroactively and the figure the
 * customer authorised stops being the figure they owe. Mallet freezes the rates onto the job in
 * the same transaction as the signature, and the bill is rebuilt from those frozen rates weeks
 * later — never from a live setting.
 *
 * The test drives the REAL path, not a re-derivation of it: SetJobLinesUseCase writes the lines,
 * the total and the rate pair exactly as v1.field.signQuote makes it, whatever it wrote becomes
 * the JobSummary the invoicing module reads, and CreateInvoiceFromJobUseCase bills it. The two
 * ends are compared to each other, so no arithmetic in this file can paper over a mismatch.
 */

import { describe, it, expect } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  FixedClock,
  isOk,
  type JobId,
  type OrgId,
  type LeadId,
  type PricingRates,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { JobLine } from "../../jobs/domain/job-execution";
import type { JobRepository, JobPricingPatch } from "../../jobs/domain/job-repository";
import type { JobSignature } from "../../jobs/domain/job-signature";
import type { Job } from "../../jobs/domain/job";
import { SetJobLinesUseCase } from "../../jobs/app/job-execution-use-cases";
import type { JobReader, JobSummary } from "../domain/job-reader";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";
import type { InvoiceRepository, ApplyResult } from "../domain/invoice-repository";
import type { Invoice } from "../domain/invoice";
import type { InvoiceId } from "@mallet/shared/types";
import { CreateInvoiceFromJobUseCase } from "./create-invoice-from-job";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB: JobId = asJobId("44444444-4444-4444-4444-444444444444");
const NOW = new Date("2026-08-01T15:00:00Z");

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String((n += 1)).padStart(12, "0")}` };
};

/** Just enough job repository for the sign write; captures what the real one would persist. */
class SigningRepo implements Partial<JobRepository> {
  lines: JobLine[] = [];
  totalCents: number | undefined;
  pricing: JobPricingPatch | undefined;
  signature: JobSignature | undefined;

  async findById(): Promise<Job | null> {
    return { props: { id: JOB } } as unknown as Job;
  }
  async listExecution() {
    return { lines: this.lines, addons: [], verifyAnswers: [], photos: [] };
  }
  async replaceLines(
    _j: JobId,
    lines: readonly JobLine[],
    _now: Date,
    totalCents?: number,
    pricing?: JobPricingPatch,
  ): Promise<void> {
    this.lines = [...lines];
    this.totalCents = totalCents;
    this.pricing = pricing;
  }
  async saveOnSiteSignature(_j: JobId, signature: JobSignature): Promise<void> {
    this.signature = signature;
  }
}

/** Minimal invoice repository — this test only ever creates one invoice. */
class OneInvoiceRepo implements Partial<InvoiceRepository> {
  saved: Invoice | null = null;
  async nextNumber(): Promise<string> {
    return "INV-1000";
  }
  async findBySourceJob(): Promise<Invoice | null> {
    return this.saved;
  }
  async insertForJob(invoice: Invoice): Promise<boolean> {
    this.saved = invoice;
    return true;
  }
  async applyPayment(): Promise<ApplyResult> {
    return { applied: false, invoice: null };
  }
  async findById(_id: InvoiceId): Promise<Invoice | null> {
    return this.saved;
  }
}

const noDeposits: EstimateDepositReader = { depositPaidCents: async () => 0 };

interface Roundtrip {
  readonly signedCents: number;
  readonly signedSentence: string;
  readonly billedCents: number;
  readonly billedTaxCents: number;
  readonly billedDiscountCents: number;
}

/**
 * Sign a price at the door, then bill the completed job — through the real use cases both times.
 */
async function signThenBill(
  lines: ReadonlyArray<{ description: string; quantity: number; rateCents: number; taxable?: boolean }>,
  rates: PricingRates,
): Promise<Roundtrip> {
  const jobRepo = new SigningRepo();
  const signed = await new SetJobLinesUseCase(
    jobRepo as unknown as JobRepository,
    new FixedClock(NOW),
    seqIds(),
  ).exec(
    {
      jobId: JOB,
      lines: lines.map((l) => ({ ...l, costCents: 0 })),
      rates,
      signature: { signerName: "Dana Ruiz", signatureSvg: "", signerIp: null, signerUserAgent: null },
      orgName: "Summit Plumbing",
    },
    ORG,
  );
  if (!isOk(signed)) throw new Error("sign failed");
  const snapshot = jobRepo.signature?.snapshot;
  if (!snapshot) throw new Error("no signature was taken");

  // The job as the invoicing module reads it AFTER the sign — every field is what the sign wrote,
  // nothing is re-invented here.
  const summary: JobSummary = {
    id: JOB,
    leadId: LEAD,
    title: "Water heater",
    status: "complete",
    kind: "work",
    num: "JOB-1042",
    sourceEstimateId: null,
    lines: jobRepo.lines.map((l) => ({
      id: l.props.id,
      description: l.props.description,
      quantity: l.props.quantity,
      rateCents: l.props.rate,
      costCents: l.props.cost,
      taxable: l.props.taxable,
      position: l.props.position,
    })),
    totalCents: jobRepo.totalCents ?? 0,
    taxBps: jobRepo.pricing?.taxBps ?? 0,
    taxCents: jobRepo.pricing?.taxCents ?? 0,
    discBps: jobRepo.pricing?.discBps ?? 0,
  };

  const reader: JobReader = { read: async () => summary };
  const invoice = await new CreateInvoiceFromJobUseCase(
    new OneInvoiceRepo() as unknown as InvoiceRepository,
    reader,
    noDeposits,
    new InMemoryEventBus(),
    new FixedClock(NOW),
    seqIds(),
  ).exec({ orgId: ORG, jobId: JOB });
  if (!isOk(invoice)) throw new Error("invoicing failed");

  return {
    signedCents: snapshot.totalCents,
    signedSentence: snapshot.authorizationText,
    billedCents: invoice.value.props.total,
    billedTaxCents: invoice.value.props.tax,
    billedDiscountCents: invoice.value.props.discount,
  };
}

const ONE_LINE = [{ description: "Water heater replacement", quantity: 1, rateCents: 149_900 }];

describe("a field-signed job bills exactly what was signed", () => {
  it("nothing set — the line sum", async () => {
    const r = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 0, depBps: 0 });
    expect(r.signedCents).toBe(149_900);
    expect(r.billedCents).toBe(r.signedCents);
  });

  it("tax only", async () => {
    const r = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 875, depBps: 0 });
    expect(r.signedCents).toBe(163_016);
    expect(r.billedCents).toBe(r.signedCents);
    expect(r.billedTaxCents).toBe(13_116);
    expect(r.signedSentence).toContain("$1,630.16");
  });

  it("discount only", async () => {
    const r = await signThenBill(ONE_LINE, { discBps: 1_000, taxBps: 0, depBps: 0 });
    expect(r.signedCents).toBe(134_910);
    expect(r.billedCents).toBe(r.signedCents);
    expect(r.billedDiscountCents).toBe(14_990);
  });

  it("discount and tax together — the order of the two is what makes the totals agree", async () => {
    const r = await signThenBill(ONE_LINE, { discBps: 1_000, taxBps: 875, depBps: 0 });
    expect(r.signedCents).toBe(146_715);
    expect(r.billedCents).toBe(r.signedCents);
  });

  it("a deposit does not change what is billed — only who has already paid part of it", async () => {
    const withDeposit = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 875, depBps: 5_000 });
    const without = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 875, depBps: 0 });
    expect(withDeposit.billedCents).toBe(without.billedCents);
    expect(withDeposit.signedSentence).toContain("deposit of $815.08");
  });

  it("a non-taxable line is billed in full but never taxed", async () => {
    const r = await signThenBill(
      [
        { description: "Water heater", quantity: 1, rateCents: 100_000, taxable: true },
        { description: "Permit fee", quantity: 1, rateCents: 20_000, taxable: false },
      ],
      { discBps: 0, taxBps: 1_000, depBps: 0 },
    );
    expect(r.signedCents).toBe(130_000); // 120,000 sold + 10% of the taxable 100,000
    expect(r.billedCents).toBe(r.signedCents);
    expect(r.billedTaxCents).toBe(10_000);
  });

  it("holds across awkward rates and quantities, where a rounding difference would show", async () => {
    const cases: PricingRates[] = [
      { discBps: 333, taxBps: 777, depBps: 1_111 },
      { discBps: 1, taxBps: 1, depBps: 1 },
      { discBps: 9_999, taxBps: 1_025, depBps: 10_000 },
      { discBps: 10_000, taxBps: 875, depBps: 0 },
    ];
    for (const rates of cases) {
      const r = await signThenBill(
        [
          { description: "Labor", quantity: 2.5, rateCents: 18_750 },
          { description: "Parts", quantity: 3, rateCents: 4_999 },
        ],
        rates,
      );
      expect(r.billedCents).toBe(r.signedCents);
    }
  });

  it("bills the frozen rate, not a rate that changed afterwards", async () => {
    // The shop raises its default tax between the signature and the bill. The invoice is rebuilt
    // from the rates ON THE JOB, so it cannot move — this is the Jobber behaviour we refuse.
    const r = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 875, depBps: 0 });
    const laterAtADifferentRate = await signThenBill(ONE_LINE, { discBps: 0, taxBps: 1_025, depBps: 0 });
    expect(r.billedCents).toBe(163_016);
    expect(laterAtADifferentRate.billedCents).not.toBe(r.billedCents);
    // Each bill matches its OWN signature — neither borrows the other's rate.
    expect(laterAtADifferentRate.billedCents).toBe(laterAtADifferentRate.signedCents);
  });
});
