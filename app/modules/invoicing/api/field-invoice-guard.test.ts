import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  asInvoiceId,
  asOrgId,
  asLeadId,
  asJobId,
  asUserId,
  money,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import type { JobId, UserId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import type { JobStatus } from "@mallet/jobs";
import { Invoice } from "../domain/invoice";
import type { FieldScopeReader, FieldJobScope } from "../domain/field-scope-reader";
import { assertFieldInvoiceScope, assertFieldJobScope } from "./field-invoice-guard";

// Imports the guard file DIRECTLY, never the module barrel — a barrel pulls the API router and
// with it the config validator, which throws without DB env (see CLAUDE.md).

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const TECH = asUserId("44444444-4444-4444-4444-444444444444");
const OTHER_TECH = asUserId("55555555-5555-5555-5555-555555555555");
const SOURCE_JOB = asJobId("66666666-6666-6666-6666-666666666666");
const SCOPE_JOB = asJobId("77777777-7777-7777-7777-777777777777");

const OUT_OF_SCOPE = "that invoice isn't on one of your jobs.";

const techPrincipal: Principal = { userId: TECH, orgId: ORG, role: "tech" };

const invoiceWith = (links: { sourceJobId?: JobId | null; scopeJobId?: JobId | null }): Invoice => {
  const now = new Date("2026-08-01T12:00:00Z");
  const created = Invoice.create({
    id: asInvoiceId("11111111-1111-1111-1111-111111111111"),
    orgId: ORG,
    num: "INV-1000",
    sourceJobId: links.sourceJobId ?? null,
    scopeJobId: links.scopeJobId ?? null,
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    title: "Water heater",
    status: "sent",
    total: money(84_000),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines: [],
    termsDays: 7,
    sentAt: now,
    dueAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(created)) throw new Error("test invoice failed to build");
  return created.value;
};

/** A scope reader with a fixed answer per job id. Absent = the job does not exist. */
const readerOf = (
  answers: Partial<Record<string, { status: JobStatus; assignee: UserId }>>,
): FieldScopeReader => ({
  forJob: async (jobId: JobId, userId: UserId): Promise<FieldJobScope | null> => {
    const found = answers[String(jobId)];
    if (!found) return null;
    return { jobId, status: found.status, assignedToCaller: found.assignee === userId };
  },
});

const codeOf = async (fn: () => Promise<unknown>): Promise<{ code: string; message: string }> => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TRPCError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected the guard to refuse, but it allowed the call");
};

describe("assertFieldInvoiceScope — the decision table", () => {
  it("lets owner and office straight through, without reading anything", async () => {
    // The reader would refuse every job; it must never be consulted for a non-tech caller.
    const neverCalled: FieldScopeReader = {
      forJob: async () => {
        throw new Error("the scope reader must not be consulted for owner/office");
      },
    };
    for (const role of ["owner", "office"] as const) {
      const principal: Principal = { userId: TECH, orgId: ORG, role };
      const result = await assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: SOURCE_JOB }),
        neverCalled,
        principal,
      );
      expect(result).toBeNull();
    }
  });

  it("refuses an invoice with BOTH links null to every tech, always", async () => {
    // The lead-tied manual invoice. There is no job, therefore no assignment, therefore no
    // predicate to evaluate — and "same lead as one of my jobs" would reach every invoice a
    // repeat customer ever received.
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: null, scopeJobId: null }),
        readerOf({ [SOURCE_JOB]: { status: "complete", assignee: TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  it("refuses with NOT_FOUND — never FORBIDDEN — when the linked job does not exist", async () => {
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: SOURCE_JOB }),
        readerOf({}),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  it("refuses another tech's job with the SAME sentence — no existence oracle", async () => {
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: SOURCE_JOB }),
        readerOf({ [SOURCE_JOB]: { status: "complete", assignee: OTHER_TECH } }),
        techPrincipal,
      ),
    );
    // Identical to the job-does-not-exist refusal above. If these two ever diverge, one invoice id
    // at a time tells a tech which invoices the shop holds.
    expect(refusal).toEqual({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  it("refuses a canceled job with BAD_REQUEST naming the next step", async () => {
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: SOURCE_JOB }),
        readerOf({ [SOURCE_JOB]: { status: "canceled", assignee: TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({
      code: "BAD_REQUEST",
      message: "This job was canceled — ask the office.",
    });
  });

  it.each(["scheduled", "in_progress"] as const)(
    "refuses a %s job — close-out REQUIRES complete (the terminal-gate inversion)",
    async (status) => {
      // Every OTHER field write refuses job.isTerminal(), and `complete` IS terminal. Copying that
      // pattern here would refuse every job this feature exists to serve. This test is what stops a
      // future refactor from pasting isTerminal() in.
      const refusal = await codeOf(() =>
        assertFieldInvoiceScope(
          invoiceWith({ sourceJobId: SOURCE_JOB }),
          readerOf({ [SOURCE_JOB]: { status, assignee: TECH } }),
          techPrincipal,
        ),
      );
      expect(refusal).toEqual({
        code: "BAD_REQUEST",
        message: "Finish the job before taking payment.",
      });
    },
  );

  it("allows the assigned tech on their own completed job, and returns its scope", async () => {
    const scope = await assertFieldInvoiceScope(
      invoiceWith({ sourceJobId: SOURCE_JOB }),
      readerOf({ [SOURCE_JOB]: { status: "complete", assignee: TECH } }),
      techPrincipal,
    );
    expect(scope).toEqual({ jobId: SOURCE_JOB, status: "complete", assignedToCaller: true });
  });
});

describe("assertFieldInvoiceScope — authorizing through the scope link", () => {
  it("authorizes a lead-tied fee invoice through scopeJobId alone", async () => {
    // The declined-estimate trip fee: sourceJobId is null ON PURPOSE (it must not consume the
    // job's one invoice slot), so scopeJobId is the only thing that can authorize it.
    const scope = await assertFieldInvoiceScope(
      invoiceWith({ sourceJobId: null, scopeJobId: SCOPE_JOB }),
      readerOf({ [SCOPE_JOB]: { status: "complete", assignee: TECH } }),
      techPrincipal,
    );
    expect(scope).toEqual({ jobId: SCOPE_JOB, status: "complete", assignedToCaller: true });
  });

  it("refuses a scope link pointing at somebody else's job", async () => {
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: null, scopeJobId: SCOPE_JOB }),
        readerOf({ [SCOPE_JOB]: { status: "complete", assignee: OTHER_TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  it("falls back to the scope link when the source job is not this tech's", async () => {
    const scope = await assertFieldInvoiceScope(
      invoiceWith({ sourceJobId: SOURCE_JOB, scopeJobId: SCOPE_JOB }),
      readerOf({
        [SOURCE_JOB]: { status: "complete", assignee: OTHER_TECH },
        [SCOPE_JOB]: { status: "complete", assignee: TECH },
      }),
      techPrincipal,
    );
    expect(scope?.jobId).toBe(SCOPE_JOB);
  });

  it("does not leak a foreign job's status through the choice of error", async () => {
    // The source job is canceled AND belongs to someone else; the scope job is nobody's. The
    // refusal must be the flat NOT_FOUND, not "This job was canceled" — which would confirm the
    // existence and state of a job the caller has no claim to.
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: SOURCE_JOB, scopeJobId: SCOPE_JOB }),
        readerOf({
          [SOURCE_JOB]: { status: "canceled", assignee: OTHER_TECH },
          [SCOPE_JOB]: { status: "canceled", assignee: OTHER_TECH },
        }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  it("still applies the status gate on the link that DID authorize", async () => {
    const refusal = await codeOf(() =>
      assertFieldInvoiceScope(
        invoiceWith({ sourceJobId: null, scopeJobId: SCOPE_JOB }),
        readerOf({ [SCOPE_JOB]: { status: "in_progress", assignee: TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({
      code: "BAD_REQUEST",
      message: "Finish the job before taking payment.",
    });
  });
});

describe("assertFieldJobScope — the job-ID-addressed gate", () => {
  it("keeps FORBIDDEN and names the real problem", async () => {
    // A tech legitimately holds job ids (myDay hands them out), so there is no oracle to close
    // here — and the house copy rule is to say what is actually wrong.
    const refusal = await codeOf(() =>
      assertFieldJobScope(
        SOURCE_JOB,
        readerOf({ [SOURCE_JOB]: { status: "complete", assignee: OTHER_TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal).toEqual({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  });

  it("refuses a job that is not complete", async () => {
    const refusal = await codeOf(() =>
      assertFieldJobScope(
        SOURCE_JOB,
        readerOf({ [SOURCE_JOB]: { status: "scheduled", assignee: TECH } }),
        techPrincipal,
      ),
    );
    expect(refusal.code).toBe("BAD_REQUEST");
  });

  it("returns null for owner/office", async () => {
    const principal: Principal = { userId: TECH, orgId: ORG, role: "owner" };
    const result = await assertFieldJobScope(SOURCE_JOB, readerOf({}), principal);
    expect(result).toBeNull();
  });
});
