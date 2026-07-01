// One seam turning transport errors into user-facing copy. Validation/not-found/conflict messages
// are authored server-side for users and pass through; everything else maps to fixed copy so raw
// provider/DB text never reaches the UI.
const FIXED: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "Your role can't do that.",
  PRECONDITION_FAILED: "That feature isn't set up yet for this account.",
  TOO_MANY_REQUESTS: "The assistant is busy. Try again in a moment.",
  BAD_GATEWAY: "The assistant is unavailable right now. Try again shortly.",
};
const PASS_THROUGH = new Set(["BAD_REQUEST", "NOT_FOUND", "CONFLICT"]);
const FALLBACK = "Something went wrong. Try again.";

export const userMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    const code = data?.code ?? "";
    if (FIXED[code]) return FIXED[code];
    if (PASS_THROUGH.has(code) && "message" in error) return String((error as { message: unknown }).message);
  }
  return FALLBACK;
};
