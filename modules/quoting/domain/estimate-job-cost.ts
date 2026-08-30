/**
 * A cost on the job this quote prices that is not one of the quote's lines — a permit, a
 * dumpster, a sub's day, or a purchase order already placed against the job.
 *
 * It never touches the customer's price. It exists so the margin the estimator reads is the
 * real one: a $4,495 repaint with a $400 dumpster behind it is not a $4,495 repaint.
 *
 * A cost pulled from a purchase order records WHICH order it came from, and the amount is
 * frozen at that moment. The link is provenance, not a subscription: the order can be edited
 * afterwards and the quote's costing stays what the estimator saw when they priced it.
 */
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

export const MAX_JOB_COST_DESCRIPTION_CHARS = 500;

export interface EstimateJobCostProps {
  readonly id: string;
  readonly description: string;
  readonly amountCents: number;
  /** The purchase order this was pulled from. Null on a cost the estimator typed. */
  readonly purchaseOrderId: string | null;
  readonly position: number;
}

export class EstimateJobCost {
  private constructor(private readonly p: EstimateJobCostProps) {}

  static create(props: EstimateJobCostProps): Result<EstimateJobCost, ValidationError> {
    const description = props.description.trim();
    if (description.length === 0) {
      return err(validation("a job cost needs a description", "description"));
    }
    if (description.length > MAX_JOB_COST_DESCRIPTION_CHARS) {
      return err(
        validation(
          `a job cost description cannot exceed ${MAX_JOB_COST_DESCRIPTION_CHARS} characters`,
          "description",
        ),
      );
    }
    if (!Number.isInteger(props.amountCents) || props.amountCents < 0) {
      return err(validation("a job cost cannot be negative", "amountCents"));
    }
    if (!Number.isInteger(props.position) || props.position < 0) {
      return err(validation("position must be a whole number, 0 or more", "position"));
    }
    return ok(new EstimateJobCost({ ...props, description }));
  }

  get props(): EstimateJobCostProps {
    return this.p;
  }
}

/** What the job costs beyond the quote's own lines, in cents. */
export function jobCostTotalCents(costs: readonly EstimateJobCost[]): number {
  return costs.reduce((sum, cost) => sum + cost.props.amountCents, 0);
}

/**
 * The purchase orders already pulled onto this quote.
 *
 * The picker reads this to refuse a second pull of the same order — the office looking at a
 * list of orders has no way to remember which ones they already took, and a doubled $2,140
 * order is a margin that reads right and is not.
 */
export function pulledOrderIds(costs: readonly EstimateJobCost[]): Set<string> {
  const ids = new Set<string>();
  for (const cost of costs) {
    if (cost.props.purchaseOrderId) ids.add(cost.props.purchaseOrderId);
  }
  return ids;
}
