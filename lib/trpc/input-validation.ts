/**
 * lib/trpc/input-validation.ts
 *
 * The one place that knows what a rejected INPUT looks like and what to say about it.
 *
 * A domain refusal and an input rejection both leave the server as BAD_REQUEST, and BAD_REQUEST is
 * a pass-through code on the client — correctly, because a refusal's sentence was written by a
 * human for a human. An input rejection wears the same code and is not a sentence at all: tRPC
 * puts the serialized Zod issue array in the message. So a settings field one character over its
 * cap, a text over 1600, and a blank price cell in a supplier sheet all rendered
 * `[{"code":"too_big","maximum":200,…}]` at a shop owner.
 *
 * This module is the split. `zodIssuesOf` is how the SERVER formatter recognises the rejection
 * (structured, before anything is serialized); `isInputValidationError` is how a CLIENT surface
 * recognises it afterwards. The import modal already needed the second one — it is the same
 * question, so it is the same predicate rather than a second copy of the guesswork.
 */

/** Wire key the error formatter stamps on an input rejection, so a client branches on a fact. */
export const INPUT_VALIDATION_FIELD = "inputValidation";

/**
 * The shape we read off a Zod issue. Deliberately structural rather than `z.ZodIssue`: this module
 * is imported by client bundles that have no business pulling Zod in, and the three keys below are
 * stable across Zod majors in a way the discriminated-union type is not.
 */
export interface InputIssue {
  readonly code?: unknown;
  readonly path?: unknown;
  readonly maximum?: unknown;
}

/** The Zod issues behind a thrown cause, or null when the cause is not a Zod rejection. */
export function zodIssuesOf(cause: unknown): readonly InputIssue[] | null {
  if (typeof cause !== "object" || cause === null) return null;
  const issues = (cause as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues as readonly InputIssue[];
}

/** "unitPriceCents" → "unit price cents". The field name is the only handle a person has. */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The field an issue is about: the last NAMED segment of its path. Array indices are dropped —
 * `rows.12.price` is the price column, and "row 12" is a number the person pasting a supplier
 * sheet cannot map back to anything they can see.
 */
function fieldOf(issue: InputIssue): string | null {
  if (!Array.isArray(issue.path)) return null;
  for (let i = issue.path.length - 1; i >= 0; i -= 1) {
    const segment: unknown = issue.path[i];
    if (typeof segment === "string" && segment !== "") return humanize(segment);
  }
  return null;
}

/** Shown when the issues name no field at all — rare, but a blank error box is worse. */
const GENERIC_COPY = "Some of what you entered wasn't accepted. Check the values and try again.";

/** The sentence to show for a rejected input. Never the issues themselves. */
export function inputValidationMessage(issues: readonly InputIssue[]): string {
  const fields = [...new Set(issues.map(fieldOf).filter((f): f is string => f !== null))];

  // The overwhelmingly common case, and the only one where the server knows the exact remedy: one
  // field, over its cap. Naming the cap is what turns "try again" into something that can succeed.
  const [only] = issues;
  const [field] = fields;
  if (issues.length === 1 && field !== undefined && only?.code === "too_big" && typeof only.maximum === "number") {
    return `${sentenceCase(field)} is too long — ${only.maximum} characters maximum.`;
  }

  if (fields.length === 0) return GENERIC_COPY;
  const wasWere = fields.length === 1 ? "that value wasn't" : "those values weren't";
  return `Check ${fields.join(", ")} and try again — ${wasWere} accepted.`;
}

/**
 * A serialized Zod payload, not prose. tRPC gives an array of issues for a batch rejection and
 * occasionally a bare object for a single one, so both openers count — and the issue keys have to
 * be present, otherwise a legitimate message that merely starts with a bracket would be swallowed.
 */
function isSerializedZodPayload(message: string): boolean {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
  return /"code"\s*:|"expected"\s*:|"invalid_type"/.test(trimmed);
}

/**
 * True when this transport error is an input rejection rather than a hand-authored refusal.
 *
 * The tag is the answer for anything that crossed the wire. The serialized-payload fallback is for
 * an error that never met the formatter — a direct `createCaller` in an integration test — so the
 * predicate gives the same answer on both sides of the transport.
 */
export function isInputValidationError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "data" in err) {
    const data = (err as { data?: Record<string, unknown> | null }).data;
    if (data != null && data[INPUT_VALIDATION_FIELD] === true) return true;
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return isSerializedZodPayload(message);
}
