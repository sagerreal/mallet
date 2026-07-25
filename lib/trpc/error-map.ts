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

/**
 * The key a domain refusal's machine-readable tag travels under on a tRPC error (written by the
 * errorFormatter in trpc/init.ts, read by `appErrorField` below).
 *
 * tRPC puts only a code and a sentence on the wire. A client that must react to ONE specific rule —
 * "this week still has hours with no end time" as opposed to any other bad request — would otherwise
 * have to pattern-match a sentence written for humans, which is free to be reworded at any time.
 */
export const APP_ERROR_FIELD = "appErrorField";

/** The domain tag on a transport error, or null when it carries none. */
export const appErrorField = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const data = (error as { data?: Record<string, unknown> | null }).data;
  const tag = data == null ? undefined : data[APP_ERROR_FIELD];
  return typeof tag === "string" && tag !== "" ? tag : null;
};

/**
 * `fallback` replaces the generic sentence when a surface can say something more useful about the
 * thing that failed ("the call could not be placed"). It is only ever used for errors that carry
 * NO user-facing message of their own — a domain refusal still passes its own wording through.
 */
export const userMessage = (error: unknown, fallback: string = FALLBACK): string => {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    const code = data?.code ?? "";
    if (FIXED[code]) return FIXED[code];
    if (PASS_THROUGH.has(code) && "message" in error) return String((error as { message: unknown }).message);
  }
  return fallback;
};
