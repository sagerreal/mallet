/**
 * features/invoices/visit-fee.ts
 * The visit/diagnostic fee an org collects on a declined estimate visit is raised as a
 * LEAD-tied manual invoice (never job-tied — see the comment on collectVisitFee in
 * tech-job-modal.tsx for why: invoices.source_job_id carries a partial unique index, one
 * active invoice per job, and a job-tied fee invoice would permanently claim that slot, so a
 * later quote-accept on the same job could never raise its real bill).
 *
 * VISIT_FEE_TITLE is a single shared sentinel used BOTH when creating the invoice (its
 * `title` field) and when guarding against collecting it twice (matching on
 * `invoice.title === VISIT_FEE_TITLE` for the job's lead). It survives reload — title + leadId
 * both come through the invoices hydrator — unlike a client-side jobId, which the server never
 * stamps on a manual invoice (sourceJobId is hardcoded null for the manual/draft path) and so
 * cannot be trusted as the durable guard.
 */
export const VISIT_FEE_TITLE = "Visit fee — service call";
