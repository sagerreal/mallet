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
//
// FOUND WORK IS THE ONE EXEMPTION, and it is opt-in per caller (`showAddonRates`).
// An add-on's RATE is the number the CUSTOMER is about to read off the same tablet
// and sign for, so on the technician's own screens it is shown whatever
// techSeesPrice says: the setting exists to keep techs out of the shop's margins,
// not to hide from a customer the price they are being asked to agree to. A $0
// approval sheet in front of a customer asking "how much?" is the failure mode.
//
// It is OFF by default on purpose. The AI field copilot redacts through this same
// helper and its prompt forbids the model from stating any price in a !seesPrice
// shop — a global flip would put prices in the model's context that it is under
// instruction never to say. A caller that has not thought about it gets the strict
// reading. Add-on COST is stripped either way: that is the margin.

export interface PricedRow {
  rate: { cents: number; currency: "USD" } | null;
  cost: { cents: number; currency: "USD" } | null;
}

/** Per-caller relaxations of the strict reading. See the found-work note above. */
export interface RedactionPolicy {
  /** Keep add-on rates regardless of techSeesPrice. The technician's own screens set this. */
  readonly showAddonRates?: boolean;
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
  policy: RedactionPolicy = {},
): T & { total: { cents: number; currency: "USD" } | null } => ({
  ...dto,
  lines: dto.lines.map((l) => redactRow(l, seesPrice)),
  addons: dto.addons.map((a) => redactRow(a, policy.showAddonRates === true || seesPrice)),
  // Aggregate total is redacted when the tech has no price visibility — the sum of
  // line rates is still derivable from the line items, so null-total is the correct
  // signal for "price hidden" rather than a fabricated zero. Visible found-work rates
  // do not reopen it: the total is the JOB's price, not the add-ons'.
  total: seesPrice ? dto.total : null,
});

/**
 * The technician's own screens, where the customer is standing next to the tablet.
 *
 * Named and exported so the exemption is one greppable constant rather than a boolean repeated at
 * nine call sites — and so the AI copilot's strict reading stays visibly the default.
 */
export const FIELD_SURFACE_REDACTION: RedactionPolicy = { showAddonRates: true };
