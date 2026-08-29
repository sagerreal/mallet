/**
 * One part of a saved ASSEMBLY — a pricebook entry built from the parts and labour under it,
 * so a shop types "Cedar privacy fence" once and quotes it forever.
 *
 * A TEMPLATE, not a quote line. There is no quantity here, only the expression a quantity is
 * counted by (`qty/8+1`): the number does not exist until the row lands on an estimate with a
 * driver quantity to count off. The fields mirror the estimate line's component fields exactly,
 * so applying a saved assembly is a copy rather than a translation — a translation is where the
 * two would drift.
 */
import type { Result, ValidationError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";

/** Matches the column, and the estimate line's own bound. */
export const MAX_COMPONENT_UNIT_CHARS = 20;
export const MAX_COMPONENT_DESCRIPTION_CHARS = 500;
/**
 * The same bound quoting puts on `estimate_lines.qty_expr`. Restated rather than imported —
 * the module boundary rule forbids reaching into quoting's internals, and importing its barrel
 * pulls the API router and the config validator, which throws with no DB env. A test pins the
 * two together (item-component.test.ts), so they cannot drift in silence.
 */
export const MAX_COMPONENT_QTY_EXPR_LENGTH = 120;

export interface ItemComponentProps {
  readonly id: string;
  readonly description: string;
  readonly unit: string | null;
  /** How the count is expressed against the assembly's quantity. Null = one per assembly. */
  readonly qtyExpr: string | null;
  readonly roundUp: boolean;
  readonly unitCostCents: number;
  readonly unitPriceCents: number;
  /** Set when the component prices FROM its cost. Null means the price was typed. */
  readonly markupBps: number | null;
  readonly position: number;
}


/**
 * The written fields, trimmed and bounded. Blank normalizes to null so "absent" and "empty"
 * are one thing — the same rule the estimate line follows.
 *
 * The expression is NOT evaluated. A template has no driver to count off, and refusing one for
 * a driver it will only meet later would reject a perfectly good saved assembly; the estimate
 * line re-validates it against a real quantity on the way in.
 */
function validateText(
  props: ItemComponentProps,
): Result<Pick<ItemComponentProps, "description" | "unit" | "qtyExpr">, ValidationError> {
  const description = props.description.trim();
  if (description.length === 0) {
    return err(validation("component description is required", "description"));
  }
  if (description.length > MAX_COMPONENT_DESCRIPTION_CHARS) {
    return err(
      validation(
        `component description cannot exceed ${MAX_COMPONENT_DESCRIPTION_CHARS} characters`,
        "description",
      ),
    );
  }
  const unit = props.unit?.trim() ?? "";
  if (unit.length > MAX_COMPONENT_UNIT_CHARS) {
    return err(validation(`unit cannot exceed ${MAX_COMPONENT_UNIT_CHARS} characters`, "unit"));
  }
  const qtyExpr = props.qtyExpr?.trim() ?? "";
  if (qtyExpr.length > MAX_COMPONENT_QTY_EXPR_LENGTH) {
    return err(
      validation(
        `quantity math cannot exceed ${MAX_COMPONENT_QTY_EXPR_LENGTH} characters`,
        "qtyExpr",
      ),
    );
  }
  return ok({
    description,
    unit: unit === "" ? null : unit,
    qtyExpr: qtyExpr === "" ? null : qtyExpr,
  });
}

/** Money is never negative and the whole-number fields are whole. */
function validateNumbers(props: ItemComponentProps): ValidationError | null {
  if (props.unitCostCents < 0) return validation("unit cost must be 0 or more", "unitCostCents");
  if (props.unitPriceCents < 0) return validation("unit price must be 0 or more", "unitPriceCents");
  if (props.markupBps !== null && (!Number.isInteger(props.markupBps) || props.markupBps < 0)) {
    return validation("markup must be a whole number of basis points, 0 or more", "markupBps");
  }
  if (!Number.isInteger(props.position) || props.position < 0) {
    return validation("position must be a whole number, 0 or more", "position");
  }
  return null;
}

export class ItemComponent {
  private constructor(private readonly p: ItemComponentProps) {}

  static create(props: ItemComponentProps): Result<ItemComponent, ValidationError> {
    const text = validateText(props);
    if (!text.ok) return text;
    const numbers = validateNumbers(props);
    if (numbers) return err(numbers);
    return ok(new ItemComponent({ ...props, ...text.value }));
  }

  get props(): ItemComponentProps {
    return this.p;
  }
}

/**
 * What a saved assembly IS, ignoring which row holds it.
 *
 * The office needs to know three things about an assembly on a quote: it is not in the
 * pricebook, it matches what is there, or it has drifted from it. That comparison must ignore
 * ids and positions-of-storage and compare only what a shop would recognise as "the same
 * assembly" — otherwise re-saving an unchanged entry reads as modified forever.
 */
export function componentSignature(components: readonly ItemComponent[]): string {
  return JSON.stringify(
    [...components]
      .sort((a, b) => a.props.position - b.props.position)
      .map((c) => [
        c.props.description,
        c.props.unit ?? "",
        c.props.qtyExpr ?? "",
        c.props.roundUp,
        c.props.unitCostCents,
        c.props.unitPriceCents,
        c.props.markupBps ?? null,
      ]),
  );
}
