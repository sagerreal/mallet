import { TRPCError } from "@trpc/server";
import type { Principal } from "@mallet/identity";
import type { JobId } from "@mallet/shared/types";
import type { Invoice } from "../domain/invoice";
import type { FieldScopeReader, FieldJobScope } from "../domain/field-scope-reader";

/**
 * A technician may transact on the job in front of them; they may never administer the shop's money.
 *
 * ONE sentence for every scope refusal, and it is deliberately the same one whether the invoice
 * does not exist, belongs to a colleague, or belongs to a job that was never theirs. A technician
 * has no legitimate way to hold an invoice id outside their own work, so a distinguishable
 * FORBIDDEN would turn this endpoint into an existence oracle over the shop's entire receivables
 * book — "does invoice X exist" answered one id at a time. NOT_FOUND for all three (the choice
 * `assertOwnCallIfTech` already makes in the calls module).
 */
const OUT_OF_SCOPE = "that invoice isn't on one of your jobs.";

/** Refusals that name the next step rather than the rule that was broken (house copy rule). */
const CANCELED_JOB = "This job was canceled — ask the office.";
const NOT_COMPLETE = "Finish the job before taking payment.";

/** The scope refusal, as thrown for an INVOICE-addressed procedure. */
export const fieldInvoiceNotFound = (): TRPCError =>
  new TRPCError({ code: "NOT_FOUND", message: OUT_OF_SCOPE });

/**
 * Is this job one the caller may close out — theirs, finished, and not canceled?
 *
 * THE INVERSION TO HOLD IN YOUR HEAD: every other field write refuses `job.isTerminal()`, and
 * `complete` IS terminal. Close-out happens AFTER completion. Copying that pattern here would make
 * the feature refuse every job it exists to serve, so these procedures REQUIRE complete and refuse
 * canceled — the same rule CreateInvoiceFromJobUseCase already enforces.
 */
export const assertJobCollectable = (scope: FieldJobScope): void => {
  if (scope.status === "canceled") {
    throw new TRPCError({ code: "BAD_REQUEST", message: CANCELED_JOB });
  }
  if (scope.status !== "complete") {
    throw new TRPCError({ code: "BAD_REQUEST", message: NOT_COMPLETE });
  }
};

/**
 * The JOB-addressed gate: may this caller close out this job?
 *
 * Keeps `FORBIDDEN "this job isn't assigned to you"` — verbatim the sentence `assertOnJobIfTech`
 * uses — because a technician legitimately holds job ids (myDay hands them out), so there is no
 * oracle to close and naming the real problem is the house rule. Returns null for owner/office,
 * who are unchanged.
 */
export const assertFieldJobScope = async (
  jobId: JobId,
  scopeReader: FieldScopeReader,
  principal: Principal,
): Promise<FieldJobScope | null> => {
  if (principal.role !== "tech") return null;
  const scope = await scopeReader.forJob(jobId, principal.userId);
  if (!scope) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!scope.assignedToCaller) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
  assertJobCollectable(scope);
  return scope;
};

/**
 * The INVOICE-addressed gate: may this caller transact on this invoice?
 *
 * Authorization derives from the invoice's link to a job, and there are exactly two:
 *   • `sourceJobId` — this invoice IS the bill for that job;
 *   • `scopeJobId`  — this invoice is ABOUT that job without being its bill (the declined-estimate
 *     visit fee, deliberately lead-tied so it does not consume the job's one invoice slot).
 * Either link authorizes. An invoice carrying NEITHER is refused to every technician, always, with
 * no exception: there is no job, therefore no assignment, therefore no predicate to evaluate. Any
 * weaker rule — "the same lead as one of my jobs" — would hand a technician every invoice a repeat
 * customer has ever received.
 *
 * `sourceJobId` is tried first because it is the common case and the stronger claim; the scope link
 * is the fallback, never a substitute (it carries no uniqueness — see InvoiceProps.scopeJobId).
 *
 * Returns null for owner/office (unchanged), or the authorizing job's scope for a technician.
 */
export const assertFieldInvoiceScope = async (
  invoice: Invoice,
  scopeReader: FieldScopeReader,
  principal: Principal,
): Promise<FieldJobScope | null> => {
  if (principal.role !== "tech") return null;

  const links = [invoice.props.sourceJobId, invoice.props.scopeJobId].filter(
    (id): id is JobId => id !== null,
  );
  if (links.length === 0) throw fieldInvoiceNotFound();

  for (const jobId of links) {
    const scope = await scopeReader.forJob(jobId, principal.userId);
    if (!scope || !scope.assignedToCaller) continue;
    // Status is checked only on the link that actually authorized. Checking it on a job that was
    // never this technician's would leak that job's status through the choice of error.
    assertJobCollectable(scope);
    return scope;
  }
  throw fieldInvoiceNotFound();
};
