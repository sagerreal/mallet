import type { Money, Result, ValidationError } from "@mallet/shared/types";
import { money, validation, ok, err } from "@mallet/shared/types";

export interface InvoiceLineProps {
  readonly id: string;
  readonly sourceJobLineId: string | null;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money; // per-unit, integer cents
  readonly cost: Money;
  /**
   * Does this line take sales tax — copied from the job line it was billed from.
   *
   * The invoice's stored `tax` is the authority for what was CHARGED (it is a snapshot, not a
   * re-derivation); this is what the DOCUMENT marks, so a customer can see which line the tax
   * did not apply to. It is also what a rebuild from lines charges on.
   */
  readonly taxable: boolean;
  readonly position: number;
}

/** Create input: `taxable` may be omitted and reads as TRUE — the column's default, and what
 *  every invoice line written before taxability existed already meant. */
export type InvoiceLineCreateProps = Omit<InvoiceLineProps, "taxable"> & {
  readonly taxable?: boolean;
};

// A display line on an invoice — a frozen snapshot copied from the job/estimate. The invoice total
// is stored separately (not re-derived from lines); the line amount is still available for display.
export class InvoiceLine {
  private constructor(private readonly p: InvoiceLineProps) {}

  static create(props: InvoiceLineCreateProps): Result<InvoiceLine, ValidationError> {
    const description = props.description.trim();
    if (description.length === 0) return err(validation("line description is required", "description"));
    if (props.quantity < 0) return err(validation("line quantity cannot be negative", "quantity"));
    // Quantity persists as numeric(12,2); reject finer precision so it round-trips exactly.
    if (Math.abs(props.quantity * 100 - Math.round(props.quantity * 100)) > 1e-9) {
      return err(validation("line quantity supports at most 2 decimal places", "quantity"));
    }
    if (props.rate < 0) return err(validation("line rate cannot be negative", "rate"));
    if (props.cost < 0) return err(validation("line cost cannot be negative", "cost"));
    return ok(new InvoiceLine({ ...props, description, taxable: props.taxable ?? true }));
  }

  amount(): Money {
    return money(Math.round(this.p.quantity * this.p.rate));
  }

  get props(): InvoiceLineProps {
    return this.p;
  }
}
