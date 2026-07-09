/**
 * lib/store/call-constants.ts
 * Shared call-outcome vocabulary — used by the call bar and the log-a-call form
 * so both offer the exact same options (prototype's inline outcome list).
 */

export const CALL_OUTCOMES = [
  "Connected",
  "Left voicemail",
  "No answer",
  "Busy",
  "Wrong number",
] as const;
