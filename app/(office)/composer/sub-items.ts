/**
 * Sub-items — the estimating math behind a composer line (the PaintScout substrate
 * model: Walls × 2,400 sq ft = $9,840), and the ONE ComposerLine → wire mapping.
 *
 * Split from composer-state.ts to keep that file under the 800-line cap; composer-state
 * re-exports everything here, so import sites are unchanged. Amounts are DOLLARS like
 * every composer number; conversion to cents happens only in lineToPayload.
 */

import type { ComposerLine, TierKey } from "./composer-state";

/** One sub-item row (dollars, like every composer amount). Blank-description rows are edit
 *  scaffolding — they never price and never persist, same rule as realLines. */
export interface ComposerSubItem {
  d: string;
  q: number;
  unit?: string;
  amt: number;
}

export function emptySubItem(): ComposerSubItem {
  return { d: "", q: 1, amt: 0 };
}

/** Sub-items with a non-blank description — the only ones that price or persist. */
export function realSubItems(sub: ComposerSubItem[] | undefined): ComposerSubItem[] {
  return (sub ?? []).filter((si) => (si.d ?? "").trim() !== "");
}

/** Σ sub-item amounts in dollars, summed in integer cents so 0.1 + 0.2 stays 0.3. */
export function subItemsTotal(sub: ComposerSubItem[] | undefined): number {
  const cents = realSubItems(sub).reduce((acc, si) => acc + Math.round((si.amt ?? 0) * 100), 0);
  return cents / 100;
}

/**
 * Apply a sub-item edit to a line: the line's rate becomes the roll-up of the real rows.
 * Clearing the last row keeps the derived rate (hand-editable again) rather than zeroing a
 * price the owner already saw. Returns a new line — never mutates.
 */
export function withSubPatch(line: ComposerLine, sub: ComposerSubItem[]): ComposerLine {
  const rows = sub.map((si) => ({ ...si }));
  if (realSubItems(rows).length === 0) {
    const { sub: _cleared, ...rest } = line;
    return rows.length === 0 ? { ...rest } : { ...rest, sub: rows };
  }
  return { ...line, sub: rows, r: subItemsTotal(rows) };
}

/**
 * ComposerLine → the wire line for v1.quoting.draft / accept. ONE mapping shared by
 * buildDraftPayload and any future caller — the store slice's materialId drop happened
 * because this conversion was written twice.
 */
export function lineToPayload(l: ComposerLine & { tier?: TierKey }): {
  description: string;
  quantity: number;
  rateCents: number;
  costCents: number;
  isOptional: boolean;
  needsPhoto: boolean;
  taxable: boolean;
  tier: TierKey | undefined;
  materialId: string | null;
  scope?: string;
  subItems?: { description: string; quantity: number; unit?: string; amountCents: number }[];
  unit?: string;
  qtyExpr?: string;
  roundUp?: boolean;
  parentIndex?: number;
  customerVisible?: boolean;
  markupBps?: number;
  sectionIndex?: number;
  lineType?: "material" | "labor" | "equipment" | "subcontract" | "other";
  attachments?: { key: string; name: string }[];
} {
  const sub = realSubItems(l.sub);
  return {
    description: l.d,
    quantity: l.q ?? 1,
    rateCents: Math.round((l.r ?? 0) * 100),
    costCents: Math.round((l.c ?? 0) * 100),
    isOptional: l.opt ?? false,
    needsPhoto: l.photo ?? false,
    taxable: !l.notax,
    tier: l.tier,
    materialId: l.materialId ?? null,
    ...(l.scope?.trim() ? { scope: l.scope } : {}),
    ...(sub.length > 0
      ? {
          subItems: sub.map((si) => ({
            description: si.d,
            quantity: si.q ?? 1,
            ...(si.unit?.trim() ? { unit: si.unit } : {}),
            amountCents: Math.round((si.amt ?? 0) * 100),
          })),
        }
      : {}),
    // The composition fields are OMITTED when they carry nothing, so an ordinary line's wire
    // shape is byte-identical to what it was before assemblies existed.
    ...(l.unit?.trim() ? { unit: l.unit } : {}),
    ...(l.qtyExpr?.trim() ? { qtyExpr: l.qtyExpr } : {}),
    ...(l.roundUp ? { roundUp: true } : {}),
    ...(l.parentIndex !== undefined ? { parentIndex: l.parentIndex } : {}),
    ...(l.hidden ? { customerVisible: false } : {}),
    ...(l.markupBps !== undefined ? { markupBps: l.markupBps } : {}),
    ...(l.sectionIndex !== undefined ? { sectionIndex: l.sectionIndex } : {}),
    ...(l.ltype ? { lineType: l.ltype } : {}),
    ...(l.att?.length ? { attachments: l.att.map((a) => ({ ...a })) } : {}),
  };
}
