import type { JobId, Money, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err, money } from "@mallet/shared/types";

// ── Status / state constants ──────────────────────────────────────────────────

export type AddonStatus = "proposed" | "approved" | "declined";

/** All legal values for a job add-on's approval status. */
export const JOB_ADDON_STATUSES: readonly AddonStatus[] = ["proposed", "approved", "declined"];

export const isAddonStatus = (v: string): v is AddonStatus =>
  (JOB_ADDON_STATUSES as readonly string[]).includes(v);

export type VerifyState = "pass" | "override";

/** All legal values for a job verification answer's state. */
export const VERIFY_STATES: readonly VerifyState[] = ["pass", "override"];

export const isVerifyState = (v: string): v is VerifyState =>
  (VERIFY_STATES as readonly string[]).includes(v);

// ── JobLine ───────────────────────────────────────────────────────────────────

/** Props of a persisted, billable line item on a job. */
export interface JobLineProps {
  readonly id: string;
  readonly jobId: JobId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money;
  readonly cost: Money;
  /**
   * Does this line take sales tax — copied from the estimate line it was sold on, carried on to
   * the invoice line. A SECOND, DIFFERENT filter from a line being on the bill at all: a
   * non-taxable line is still billed, it just does not feed the tax base.
   */
  readonly taxable: boolean;
  readonly position: number;
}

/**
 * A single billable line item captured by the technician on a job.
 * Mirrors `job_lines` CHECKs: quantity ≥ 0, rate_cents ≥ 0, cost_cents ≥ 0.
 * Immutable value object (same style as EstimateLine).
 */
export class JobLine {
  private constructor(private readonly p: JobLineProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    description: string;
    quantity: number;
    rateCents: number;
    costCents: number;
    /** Omitted reads as TRUE — the column's default (`job_lines.taxable NOT NULL DEFAULT true`)
     *  and what every row written before taxability existed already meant. */
    taxable?: boolean;
    position: number;
  }): Result<JobLine, ValidationError> {
    const description = input.description.trim();
    if (description.length === 0) {
      return err(validation("line description is required", "description"));
    }
    if (input.quantity < 0) {
      return err(validation("quantity cannot be negative", "quantity"));
    }
    if (input.rateCents < 0) {
      return err(validation("rate cannot be negative", "rateCents"));
    }
    if (input.costCents < 0) {
      return err(validation("cost cannot be negative", "costCents"));
    }
    return ok(
      new JobLine({
        id: input.id,
        jobId: input.jobId,
        description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        taxable: input.taxable ?? true,
        position: input.position,
      }),
    );
  }

  get props(): JobLineProps {
    return this.p;
  }
}

// ── JobAddon ──────────────────────────────────────────────────────────────────

/**
 * The evidence behind an `approved` add-on: who took it, when, and which signed addendum it
 * belongs to. Null on a proposed or declined add-on, and null on every row approved before this
 * record existed — legacy approvals stay honestly evidence-free rather than being back-dated.
 *
 * `signerName` is RESOLVED at read from the addendum estimate, never written onto job_addons. The
 * signed amount and the signer live in exactly one place (that estimate's frozen snapshot); a copy
 * here would be a second version of the number, and an evidence trail cannot survive two.
 */
export interface AddonApproval {
  /** The staff member whose device took the approval — the in-person witness. */
  readonly byUserId: string | null;
  readonly at: Date;
  /** The signed change-order estimate carrying the customer's name, mark and frozen snapshot. */
  readonly estimateId: string | null;
  /** The customer who signed, read through `estimateId`. Null when the addendum is unreadable. */
  readonly signerName: string | null;
}

/** Props of a found-work add-on discovered on site. */
export interface JobAddonProps {
  readonly id: string;
  readonly jobId: JobId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money;
  readonly cost: Money;
  readonly isOptional: boolean;
  readonly invoiceSkip: boolean;
  readonly status: AddonStatus;
  /** Set only on an approved add-on — see AddonApproval. */
  readonly approval: AddonApproval | null;
  readonly position: number;
}

/**
 * A found-work add-on discovered on site. Status lifecycle: proposed → approved | declined.
 * invoiceSkip keeps an approved add-on off the current invoice without removing it.
 * Mirrors `job_addons` CHECKs: quantity ≥ 0, rate_cents ≥ 0, cost_cents ≥ 0, status ∈ enum.
 *
 * NO DB CHECK ties `status = 'approved'` to `approved_at`, deliberately: rows approved before the
 * evidence columns existed would fail it and the additive migration would abort on live data. The
 * rule is enforced where approvals are MADE — ApproveFoundWorkUseCase never marks one approved
 * without a captured customer signature — and a reader tells the two apart by `approval` being null.
 */
export class JobAddon {
  private constructor(private readonly p: JobAddonProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    description: string;
    quantity: number;
    rateCents: number;
    costCents: number;
    isOptional: boolean;
    invoiceSkip: boolean;
    status: string;
    approval?: AddonApproval | null;
    position: number;
  }): Result<JobAddon, ValidationError> {
    const description = input.description.trim();
    if (description.length === 0) {
      return err(validation("add-on description is required", "description"));
    }
    if (input.quantity < 0) {
      return err(validation("quantity cannot be negative", "quantity"));
    }
    if (input.rateCents < 0) {
      return err(validation("rate cannot be negative", "rateCents"));
    }
    if (input.costCents < 0) {
      return err(validation("cost cannot be negative", "costCents"));
    }
    if (!isAddonStatus(input.status)) {
      return err(validation(`unknown add-on status: ${input.status}`, "status"));
    }
    return ok(
      new JobAddon({
        id: input.id,
        jobId: input.jobId,
        description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        isOptional: input.isOptional,
        invoiceSkip: input.invoiceSkip,
        status: input.status,
        // Evidence only ever belongs to an approval. A declined row carrying a signature would
        // read as "they signed for this and we dropped it".
        approval: input.status === "approved" ? (input.approval ?? null) : null,
        position: input.position,
      }),
    );
  }

  /** What this add-on adds to the bill, in integer cents — the same rounding the job lines use. */
  amountCents(): number {
    return Math.round(this.p.quantity * this.p.rate);
  }

  get props(): JobAddonProps {
    return this.p;
  }
}

// ── JobVerifyAnswer ───────────────────────────────────────────────────────────

/** Props of a before-you-leave checklist answer. */
export interface JobVerifyAnswerProps {
  readonly jobId: JobId;
  readonly itemId: string;
  readonly state: VerifyState;
  /** How the pass was evidenced (e.g. "photo", "manual"). Null when not recorded. */
  readonly via: string | null;
  /** Required when state is "override"; null otherwise. */
  readonly reason: string | null;
}

/**
 * One before-you-leave checklist answer for a (job, checklist item) pair.
 * state: "pass" (checked, evidenced via photo or manual) | "override" (N/A, must supply reason).
 * Upsert-keyed on (jobId, itemId) — re-answering replaces the previous answer.
 * Mirrors `job_verify_answers` CHECK: state ∈ ("pass", "override").
 */
export class JobVerifyAnswer {
  private constructor(private readonly p: JobVerifyAnswerProps) {}

  static create(input: {
    jobId: JobId;
    itemId: string;
    state: string;
    via: string | null;
    reason: string | null;
  }): Result<JobVerifyAnswer, ValidationError> {
    if (!isVerifyState(input.state)) {
      return err(validation(`unknown verify state: ${input.state}`, "state"));
    }
    if (input.itemId.trim().length === 0) {
      return err(validation("itemId is required", "itemId"));
    }
    const reason = input.reason?.trim() ?? null;
    // An override answer is meaningless without a reason (mirrors the UX: "why is this N/A?").
    if (input.state === "override" && (reason ?? "").length === 0) {
      return err(validation("an override answer requires a reason", "reason"));
    }
    return ok(
      new JobVerifyAnswer({
        jobId: input.jobId,
        itemId: input.itemId,
        state: input.state,
        via: input.via,
        reason,
      }),
    );
  }

  get props(): JobVerifyAnswerProps {
    return this.p;
  }
}

// ── JobPhoto ──────────────────────────────────────────────────────────────────

/** Props of a field photo attached to a job. */
export interface JobPhotoProps {
  readonly id: string;
  readonly jobId: JobId;
  /** Org-prefixed key inside the private 'job-photos' bucket (<orgId>/<jobId>/<uuid>.<ext>). */
  readonly storagePath: string;
  readonly caption: string | null;
  /**
   * What the file is. Null means IMAGE — every row written before attachments existed was one,
   * because the upload input only ever admitted jpg/jpeg/png/webp. So null is a known value here,
   * not an unknown one.
   */
  readonly mimeType: string | null;
  /** The name a person recognises. A storage path is a uuid; a document with no name is unopenable. */
  readonly fileName: string | null;
  /** True when this upload auto-passed the next photo checklist item. */
  readonly verifyPass: boolean;
  readonly position: number;
}

/**
 * A field photo captured on a job. storagePath is the bucket key set at upload time (immutable).
 * verifyPass is set by addJobPhoto when the upload auto-checks the next verify item.
 */
export class JobPhoto {
  private constructor(private readonly p: JobPhotoProps) {}

  static create(input: {
    id: string;
    jobId: JobId;
    storagePath: string;
    caption: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    verifyPass: boolean;
    position: number;
  }): Result<JobPhoto, ValidationError> {
    const storagePath = input.storagePath.trim();
    if (storagePath.length === 0) {
      return err(validation("storage path is required", "storagePath"));
    }
    return ok(
      new JobPhoto({
        id: input.id,
        jobId: input.jobId,
        storagePath,
        caption: input.caption,
        mimeType: input.mimeType ?? null,
        fileName: input.fileName ?? null,
        verifyPass: input.verifyPass,
        position: input.position,
      }),
    );
  }

  get props(): JobPhotoProps {
    return this.p;
  }
}
