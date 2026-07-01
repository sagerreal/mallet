import type {
  EstimateId,
  EstimateLineId,
  OrgId,
  LeadId,
  Money,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { money, zeroMoney, addMoney, validation, ok, err } from "@mallet/shared/types";

export type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

export const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
];

export const isEstimateStatus = (value: string): value is EstimateStatus =>
  (ESTIMATE_STATUSES as readonly string[]).includes(value);

const BPS_DENOMINATOR = 10_000; // basis points: 10000 bps = 100%

export interface EstimateLineProps {
  readonly id: EstimateLineId;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money; // price per unit, integer cents
  readonly cost: Money; // internal material/labor cost, integer cents
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
  readonly position: number;
}

// A single priced line on an estimate. Immutable value object; its extended amount is derived,
// never stored, and rounded to whole cents so totals never accumulate float drift.
export class EstimateLine {
  private constructor(private readonly p: EstimateLineProps) {}

  static create(props: EstimateLineProps): Result<EstimateLine, ValidationError> {
    const description = props.description.trim();
    if (description.length === 0) return err(validation("line description is required", "description"));
    if (props.quantity < 0) return err(validation("line quantity cannot be negative", "quantity"));
    // Quantity persists as numeric(12,2); reject any finer precision so the value used to derive
    // money is identical before and after persistence (no silent round-trip drift). Epsilon-based
    // to tolerate float representation (e.g. 0.01 * 100 !== 1 exactly).
    if (Math.abs(props.quantity * 100 - Math.round(props.quantity * 100)) > 1e-9) {
      return err(validation("line quantity supports at most 2 decimal places", "quantity"));
    }
    if (props.rate < 0) return err(validation("line rate cannot be negative", "rate"));
    if (props.cost < 0) return err(validation("line cost cannot be negative", "cost"));
    return ok(new EstimateLine({ ...props, description }));
  }

  // Extended amount = quantity × unit rate, rounded to whole cents.
  amount(): Money {
    return money(Math.round(this.p.quantity * this.p.rate));
  }

  get props(): EstimateLineProps {
    return this.p;
  }
}

export interface EstimateProps {
  readonly id: EstimateId;
  readonly orgId: OrgId;
  readonly num: string; // per-org human number, e.g. "EST-1042"
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: EstimateStatus;
  readonly discBps: number; // discount %, basis points (0..10000)
  readonly taxBps: number; // tax %, basis points (>= 0)
  readonly depBps: number; // deposit %, basis points (0..10000)
  readonly depPaid: Money; // deposit expected/collected, cents (stamped on accept)
  readonly validDays: number | null;
  readonly sentAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly declineReason: string | null;
  readonly lines: readonly EstimateLine[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A quote for a customer. Aggregate root over its lines. All money is integer cents; percentages
// are integer basis points; every total is derived here (never stored) so there is one source of
// truth and no rounding drift. Mutations return new instances (immutability).
export class Estimate {
  private constructor(private readonly p: EstimateProps) {}

  static create(props: EstimateProps): Result<Estimate, ValidationError> {
    const num = props.num.trim();
    if (num.length === 0) return err(validation("estimate number is required", "num"));
    if (!isEstimateStatus(props.status)) {
      return err(validation(`unknown estimate status: ${props.status}`, "status"));
    }
    if (props.discBps < 0 || props.discBps > BPS_DENOMINATOR) {
      return err(validation("discount must be between 0 and 10000 bps", "discBps"));
    }
    if (props.taxBps < 0) return err(validation("tax bps cannot be negative", "taxBps"));
    if (props.depBps < 0 || props.depBps > BPS_DENOMINATOR) {
      return err(validation("deposit must be between 0 and 10000 bps", "depBps"));
    }
    return ok(new Estimate({ ...props, num }));
  }

  // --- Pure money derivations (the prototype's calcQuote, one source of truth) ---

  // Sum of non-optional line amounts. Optional add-ons are excluded until toggled (pilot: always).
  subtotal(): Money {
    return this.p.lines
      .filter((line) => !line.props.isOptional)
      .reduce((sum, line) => addMoney(sum, line.amount()), zeroMoney);
  }

  discountAmount(): Money {
    return money(Math.round((this.subtotal() * this.p.discBps) / BPS_DENOMINATOR));
  }

  netAfterDiscount(): Money {
    return money(this.subtotal() - this.discountAmount());
  }

  taxAmount(): Money {
    return money(Math.round((this.netAfterDiscount() * this.p.taxBps) / BPS_DENOMINATOR));
  }

  total(): Money {
    return money(this.netAfterDiscount() + this.taxAmount());
  }

  depositDue(): Money {
    return money(Math.round((this.total() * this.p.depBps) / BPS_DENOMINATOR));
  }

  // --- Lifecycle ---

  canSend(): boolean {
    return this.p.status === "draft" && this.subtotal() > 0;
  }
  canAccept(): boolean {
    return this.p.status === "sent";
  }
  canDecline(): boolean {
    return this.p.status === "sent";
  }

  // Draft → sent. Idempotent: re-sending an already-sent estimate is a no-op (same instance).
  send(now: Date): Result<Estimate, ValidationError> {
    if (this.p.status === "sent") return ok(this);
    if (!this.canSend()) {
      return err(validation("only a draft with a positive subtotal can be sent", "status"));
    }
    return ok(new Estimate({ ...this.p, status: "sent", sentAt: now, updatedAt: now }));
  }

  // Sent → accepted. Stamps the expected deposit (derived, not charged — payment is Phase 2).
  accept(now: Date): Result<Estimate, ValidationError> {
    if (!this.canAccept()) return err(validation("only a sent estimate can be accepted", "status"));
    return ok(
      new Estimate({
        ...this.p,
        status: "accepted",
        acceptedAt: now,
        depPaid: this.depositDue(),
        updatedAt: now,
      }),
    );
  }

  // Sent → declined, capturing the reason.
  decline(reason: string, now: Date): Result<Estimate, ValidationError> {
    if (!this.canDecline()) return err(validation("only a sent estimate can be declined", "status"));
    return ok(
      new Estimate({
        ...this.p,
        status: "declined",
        declinedAt: now,
        declineReason: reason,
        updatedAt: now,
      }),
    );
  }

  // Replace the line set — only while still a draft (content is frozen once sent).
  withLines(lines: readonly EstimateLine[], now: Date): Result<Estimate, ValidationError> {
    if (this.p.status !== "draft") {
      return err(validation("lines can only be edited on a draft", "status"));
    }
    return ok(new Estimate({ ...this.p, lines, updatedAt: now }));
  }

  get props(): EstimateProps {
    return this.p;
  }
}
