// Pure money-redaction helpers for the tech-facing field surface.
// Extracted into a separate file so unit tests can import them without pulling
// in the DB client (which requires env vars) via the field-router barrel.
//
// Price visibility for techs is an org setting (techSeesPrice) — enforcing it
// only in the client leaks full pricing (and always leaked internal cost) to
// every tech's device. On the FIELD surface: cost is ALWAYS stripped for techs;
// rate is stripped when the org turned tech price visibility off. The aggregate
// total is also stripped when !seesPrice. Office/owner responses are never
// redacted.

export interface PricedRow {
  rate: { cents: number; currency: "USD" } | null;
  cost: { cents: number; currency: "USD" } | null;
}

const redactRow = <T extends PricedRow>(row: T, seesPrice: boolean): T => ({
  ...row,
  rate: seesPrice ? row.rate : null,
  cost: null,
});

export const redactMoneyForTech = <
  T extends { lines: PricedRow[]; addons: PricedRow[]; total: { cents: number; currency: "USD" } | null },
>(
  dto: T,
  seesPrice: boolean,
): T & { total: { cents: number; currency: "USD" } | null } => ({
  ...dto,
  lines: dto.lines.map((l) => redactRow(l, seesPrice)),
  addons: dto.addons.map((a) => redactRow(a, seesPrice)),
  // Aggregate total is redacted when the tech has no price visibility — the sum of
  // line rates is still derivable from the line items, so null-total is the correct
  // signal for "price hidden" rather than a fabricated zero.
  total: seesPrice ? dto.total : null,
});
