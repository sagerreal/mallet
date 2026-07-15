import type { CallDisposition } from "../domain/call-record";

// One tool-invocation row as the ledger stores it: the tool name plus its opaque result payload
// (the VoiceToolResult we serialized — `{ speak, data? }`). Structural, not a domain object: it is
// the exact shape listByCall returns.
export interface LedgerRow {
  readonly tool: string;
  readonly result: unknown;
}

// Tool names that map to a booking. book_visit's result.data.kind distinguishes work vs estimate.
const BOOK_VISIT = "book_visit";
const REQUEST_QUOTE = "request_quote";
const ESCALATE_CALLBACK = "escalate_callback";
const TAKE_MESSAGE = "take_message";

// Read result.data as a record, tolerating any malformed/absent payload (never throws).
const dataOf = (result: unknown): Record<string, unknown> => {
  if (result && typeof result === "object" && "data" in result) {
    const data = (result as { data: unknown }).data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  }
  return {};
};

/**
 * Derive the call disposition from its tool-invocation rows. Deterministic, pure, and total.
 *
 * Precedence (highest wins): emergency > booked_estimate > booked_job > quote_request > callback >
 * message > no_action. Emergency is a cross-cutting flag — ANY tool result carrying
 * `data.emergency === true` makes the whole call an emergency regardless of what else ran (an
 * emergency booking must surface as an emergency, not merely as a booked job).
 */
export const deriveDisposition = (rows: readonly LedgerRow[]): CallDisposition => {
  const emergency = rows.some((r) => dataOf(r.result).emergency === true);
  if (emergency) return "emergency";

  const bookedEstimate = rows.some(
    (r) => r.tool === BOOK_VISIT && dataOf(r.result).kind === "estimate",
  );
  if (bookedEstimate) return "booked_estimate";

  // Only an EXPLICIT kind === "work" counts as a work booking. A book_visit row whose result
  // carries no kind (the FAILURE fallback returns `{ speak }` with no data.kind) is therefore
  // neither booked_job nor booked_estimate — a failed booking must not masquerade as a booked job.
  const bookedJob = rows.some(
    (r) => r.tool === BOOK_VISIT && dataOf(r.result).kind === "work",
  );
  if (bookedJob) return "booked_job";

  if (rows.some((r) => r.tool === REQUEST_QUOTE)) return "quote_request";
  if (rows.some((r) => r.tool === ESCALATE_CALLBACK)) return "callback";
  if (rows.some((r) => r.tool === TAKE_MESSAGE)) return "message";

  return "no_action";
};
