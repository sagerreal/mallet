import type { CallDisposition, CallSummary, PriceAudit } from "../domain/call-record";

// The subset of a frontdesk_calls row the office list needs. Kept structural (a raw DB row
// shape), never a domain object — pure input to the CallSummary DTO mapper.
export interface CallSummaryRow {
  id: string;
  createdAt: Date;
  startedAt: Date | null;
  fromNumber: string;
  disposition: string;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  priceAudit: unknown;
}

// Pure: true iff the stored price audit recorded at least one flagged amount. Tolerant of the
// jsonb column being null, malformed, or missing `flagged` — any non-array/empty case is false.
export const isPriceFlagged = (priceAudit: unknown): boolean => {
  if (priceAudit == null || typeof priceAudit !== "object") return false;
  const flagged = (priceAudit as { flagged?: unknown }).flagged;
  return Array.isArray(flagged) && flagged.length > 0;
};

// Pure: read the jsonb price_audit column into the typed domain shape (or null). Non-array
// `flagged` collapses to null rather than throwing — the column is external data.
export const readPriceAudit = (priceAudit: unknown): PriceAudit | null => {
  if (priceAudit == null || typeof priceAudit !== "object") return null;
  const flagged = (priceAudit as { flagged?: unknown }).flagged;
  if (!Array.isArray(flagged)) return null;
  return { flagged: flagged.filter((v): v is string => typeof v === "string") };
};

// Pure row → CallSummary DTO. `when` prefers the call start, falling back to created_at so the
// list always has a timestamp. Disposition is cast from the text column (the write side is the
// only writer and only ever stores a CallDisposition value).
export const toCallSummary = (row: CallSummaryRow): CallSummary => ({
  id: row.id,
  when: row.startedAt ?? row.createdAt,
  fromNumber: row.fromNumber,
  disposition: row.disposition as CallDisposition,
  summary: row.summary,
  transcript: row.transcript,
  recordingUrl: row.recordingUrl,
  priceFlagged: isPriceFlagged(row.priceAudit),
});
