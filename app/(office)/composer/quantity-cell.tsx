"use client";

/**
 * The quantity cell of a line, which may hold a number or the math that produced one.
 *
 * A component of an assembly counts off its parent: "qty/8+1" posts for a fence run. The cell
 * keeps what was TYPED and shows what it resolved to underneath, live, on every keystroke —
 * because a formula whose result you cannot see is a formula you cannot check.
 *
 * The note appears only when there is math to explain. A plain number explains itself, and a
 * note under every quantity in the quote would be noise.
 */

import { resolveQuantity, isPlainQuantity } from "./line-math";
import type { ComposerLine } from "./composer-state";

export function QuantityCell({
  line,
  parent,
  lineNo,
  onChange,
}: {
  line: ComposerLine;
  /** The line this one is a component of, when it is one. Its quantity is the driver. */
  parent?: ComposerLine;
  lineNo: number;
  onChange: (patch: Partial<ComposerLine>) => void;
}) {
  const typed = line.qtyExpr ?? String(line.q ?? 0);
  const resolved = resolveQuantity(line, parent);
  const isMath = !isPlainQuantity(typed);

  /**
   * One field writes two: `qtyExpr` is what the estimator typed, `q` is what it resolved to.
   * Plain numbers clear the expression entirely, so an ordinary line never carries one and its
   * wire shape stays what it always was.
   */
  const handle = (next: string) => {
    if (isPlainQuantity(next)) {
      onChange({ qtyExpr: undefined, q: Number(next.replace(/,/g, "")) });
      return;
    }
    const value = resolveQuantity({ ...line, qtyExpr: next }, parent);
    onChange({ qtyExpr: next, q: value.value });
  };

  return (
    <>
      <input
        className="num"
        inputMode={isMath ? "text" : "decimal"}
        value={typed}
        aria-label={parent ? `Quantity or math, component ${lineNo}` : `Quantity, line ${lineNo}`}
        aria-invalid={resolved.valid ? undefined : true}
        title={parent ? `Math can use qty — ${parent.d || "this line"}'s quantity` : undefined}
        onChange={(e) => handle(e.target.value)}
      />
      {!resolved.valid && <span className="qty-note bad">Check the math</span>}
      {resolved.valid && isMath && (
        <span className="qty-note">
          = {resolved.value}
          {line.unit ? ` ${line.unit}` : ""}
        </span>
      )}
    </>
  );
}
