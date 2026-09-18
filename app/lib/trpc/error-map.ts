// One seam turning transport errors into user-facing copy. Validation/not-found/conflict messages
// are authored server-side for users and pass through; everything else maps to fixed copy so raw
// provider/DB text never reaches the UI.
// NOTE: PRECONDITION_FAILED is deliberately NOT here. It used to map to "That feature isn't set up
// yet for this account", which is checked BEFORE the pass-through list and so silently outranked
// the server's own wording — the reason a texting failure reported a missing business number for an
// org that had one. It is a domain refusal; its sentence names the actual blocker.
const FIXED: Record<string, string> = {
  UNAUTHORIZED: "Your session expired. Sign in again.",
  FORBIDDEN: "Your role can't do that.",
  TOO_MANY_REQUESTS: "The assistant is busy. Try again in a moment.",
  BAD_GATEWAY: "The assistant is unavailable right now. Try again shortly.",
};
// PRECONDITION_FAILED belongs here for the same reason the others do: it is a DOMAIN refusal whose
// sentence names the actual blocker, and swallowing it forces every caller to guess. The messaging
// send alone raises it for three unrelated causes — no business number, A2P not approved, server
// not configured — which the thread modal then reported as the same wrong sentence, sending Owen
// hunting a business number that was there all along.
const PASS_THROUGH = new Set(["BAD_REQUEST", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"]);
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

/**
 * The tRPC code on a transport error, or null when it carries none.
 *
 * For the rare surface that must write its OWN sentence for one specific code — the texting
 * composer's carrier failure, where the shared BAD_GATEWAY copy talks about the assistant — so it
 * branches on the code rather than on the sentence.
 */
export const transportCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const code = (error as { data?: { code?: unknown } | null }).data?.code;
  return typeof code === "string" && code !== "" ? code : null;
};

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
    if (PASS_THROUGH.has(code) && "message" in error) {
      // An empty message carries no information; a blank error box is worse than the fallback.
      const message = String((error as { message: unknown }).message).trim();
      if (message !== "") return message;
    }
  }
  return fallback;
};
