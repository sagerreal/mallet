import { err, ok, type Result, type OrgId } from "@mallet/shared/types";

export type POStatus = "draft" | "ordered" | "cancelled";
export type ShipTo = "counter_pickup" | "job_site" | "shop";

export interface POLineProps {
  readonly id: string;
  readonly description: string;
  readonly qty: number;
  readonly uom: string;
  /** Thousandths of a cent — see DECISION 1 in the plan. */
  readonly unitCostMillicents: number;
  readonly position: number;
}

export interface PurchaseOrderProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly num: string | null;
  readonly vendor: string;
  readonly status: POStatus;
  readonly jobId: string | null;
  readonly orderedAt: Date | null;
  readonly expectedAt: Date | null;
  readonly shipTo: ShipTo;
  readonly orderedByUserId: string | null;
  readonly freightCents: number;
  readonly taxCents: number;
  readonly lines: readonly POLineProps[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Extended amount, rounded to whole cents. Millicents stay on the unit cost only. */
export const lineCents = (l: POLineProps): number => Math.round((l.qty * l.unitCostMillicents) / 1000);

export const subtotalCents = (po: PurchaseOrder): number =>
  po.props.lines.reduce((s, l) => s + lineCents(l), 0);

export const totalCents = (po: PurchaseOrder): number =>
  subtotalCents(po) + po.props.freightCents + po.props.taxCents;

export class PurchaseOrder {
  private constructor(public readonly props: PurchaseOrderProps) {}

  static create(props: PurchaseOrderProps): Result<PurchaseOrder, string> {
    if (!props.vendor.trim()) return err("A purchase order needs a vendor.");
    if (props.freightCents < 0) return err("Freight cannot be negative.");
    if (props.taxCents < 0) return err("Tax cannot be negative.");
    // A placed order must carry the number somebody reads to the branch; a draft must not,
    // or abandoned taps burn numbers out of a sequence that is meant to be gapless.
    if (props.status === "draft" && props.num !== null) return err("A draft has no number until it is placed.");
    if (props.status !== "draft" && !props.num) return err("A placed order must carry its number.");
    for (const l of props.lines) {
      if (!l.description.trim()) return err("Every line needs a description.");
      if (l.qty <= 0) return err("A line quantity must be greater than zero.");
      if (l.unitCostMillicents < 0) return err("A unit cost cannot be negative.");
    }
    return ok(new PurchaseOrder(props));
  }

  private with(patch: Partial<PurchaseOrderProps>): Result<PurchaseOrder, string> {
    return PurchaseOrder.create({ ...this.props, ...patch });
  }

  /** Draft → ordered. Allocates nothing itself; the caller hands in the number. */
  place(num: string, now: Date): Result<PurchaseOrder, string> {
    if (this.props.status !== "draft") return err("This order has already been placed.");
    if (this.props.lines.length === 0) return err("Add a line before placing the order.");
    return this.with({ status: "ordered", num, orderedAt: now, updatedAt: now });
  }

  cancel(): Result<PurchaseOrder, string> {
    if (this.props.status === "cancelled") return err("This order is already cancelled.");
    if (this.props.status === "draft") return err("Delete a draft rather than cancelling it — the vendor never heard of it.");
    return this.with({ status: "cancelled" });
  }

  /**
   * WHAT THE JOB IS CHARGED. The whole order once placed, nothing from a draft or a cancelled one.
   * There is no receiving (DECISION 4), so the cost lands when the order does, not when the van does.
   */
  jobCostCents(): number {
    return this.props.status === "ordered" ? totalCents(this) : 0;
  }
}
