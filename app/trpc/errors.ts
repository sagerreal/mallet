import { TRPCError } from "@trpc/server";
import type { AppError, Result } from "@mallet/shared/types";
import { APP_ERROR_FIELD } from "@/lib/trpc/error-map";
import { INPUT_VALIDATION_FIELD, inputValidationMessage, zodIssuesOf } from "@/lib/trpc/input-validation";

const CODE_BY_KIND: Record<AppError["kind"], TRPCError["code"]> = {
  validation: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  unauthorized: "UNAUTHORIZED",
  external_service: "BAD_GATEWAY",
  precondition: "PRECONDITION_FAILED",
};

// The AppError rides along as the `cause` so its machine-readable tag (a validation error's
// `field`) survives the throw and can be put on the wire by the errorFormatter. Without it the only
// thing a client could branch on is the message — a sentence written for humans, free to be
// reworded. tRPC copies a plain-object cause's own properties onto the Error it wraps it in.
export const toTRPCError = (error: AppError): TRPCError =>
  new TRPCError({ code: CODE_BY_KIND[error.kind], message: error.message, cause: error });

/**
 * The domain tag on the refusal that became this error, if it carries one — a validation error's
 * `field`. Returns null for every other cause, so untagged errors keep their existing shape.
 */
export const appErrorTagOf = (cause: unknown): string | null => {
  if (typeof cause !== "object" || cause === null) return null;
  const tag = (cause as { field?: unknown }).field;
  return typeof tag === "string" && tag !== "" ? tag : null;
};

/**
 * The whole error formatter, kept here rather than inline in `init.ts` so it can be unit-tested
 * without importing the tRPC bootstrap (which pulls the DB and the config validator with it).
 *
 * Copies a domain refusal's tag onto the error data. An untagged error is returned UNCHANGED —
 * every other error shape in the app stays exactly what tRPC made it.
 */
export const withAppErrorTag = <S extends { data?: unknown }>(shape: S, cause: unknown): S => {
  const tag = appErrorTagOf(cause);
  if (tag === null) return shape;
  const data = { ...(shape.data as object | undefined), [APP_ERROR_FIELD]: tag };
  // The cast is the price of widening tRPC's fixed shape by one key; the value is a superset of S.
  return { ...shape, data } as S;
};

/**
 * What the client is told when a resolver threw something nobody wrote for a user.
 * The real message is not lost — the tRPC route handler logs it (see app/api/trpc/[trpc]/route.ts).
 */
const INTERNAL_MESSAGE = "Something went wrong on our end. Try again.";

/**
 * Strips the message off an INTERNAL_SERVER_ERROR before it leaves the process.
 *
 * An unhandled throw carries whatever the library that threw wrote. Drizzle writes the SQL: when
 * `users.callback_number` was missing, `Failed query: select "callback_number" from "users" …`
 * was rendered verbatim in the call bar — schema on a customer-facing screen, and a sentence that
 * told the user nothing they could act on. Every OTHER code is authored server-side FOR users and
 * passes through untouched.
 *
 * Not gated on NODE_ENV: behaviour that only exists in production is behaviour no test ever runs.
 */
export const scrubInternalError = <S extends { message: string; data: { code?: unknown } }>(
  shape: S,
): S => (shape.data.code === "INTERNAL_SERVER_ERROR" ? { ...shape, message: INTERNAL_MESSAGE } : shape);

/**
 * Turns a rejected INPUT into a sentence, and marks it as one.
 *
 * A domain refusal and an input rejection both leave as BAD_REQUEST, which the client passes
 * through — right for the refusal (a human wrote that sentence for a human), wrong for the
 * rejection, whose message IS the serialized Zod issue array. That is how a settings field one
 * character over its cap, a text over 1600 and a blank price cell in a supplier sheet all put
 * `[{"code":"too_big","maximum":200,…}]` in front of a shop owner.
 *
 * Only a Zod cause is rewritten, so every hand-authored refusal keeps its own wording. The tag is
 * what lets a surface with better copy than the generic sentence — the import modal knows the
 * columns to name — branch on a fact instead of pattern-matching prose.
 */
export const flattenInputValidation = <S extends { message: string; data?: unknown }>(
  shape: S,
  cause: unknown,
): S => {
  const issues = zodIssuesOf(cause);
  if (issues === null) return shape;
  const data = { ...(shape.data as object | undefined), [INPUT_VALIDATION_FIELD]: true };
  // The cast is the price of widening tRPC's fixed shape by one key; the value is a superset of S.
  return { ...shape, message: inputValidationMessage(issues), data } as S;
};

/**
 * The whole error formatter, in order: tag a domain refusal, flatten an input rejection, strip an
 * internal error's message. Each step is a no-op for the errors the others own.
 */
export const formatAppError = <S extends { message: string; data: { code?: unknown } }>({
  shape,
  error,
}: {
  shape: S;
  error: { cause?: unknown };
}): S => scrubInternalError(flattenInputValidation(withAppErrorTag(shape, error.cause), error.cause));

// Unwrap a use-case Result at the API boundary: success value through, AppError mapped to the
// right tRPC/HTTP status. Keeps domain errors out of the transport layer.
export const orThrow = <T>(result: Result<T, AppError>): T => {
  if (result.ok) return result.value;
  throw toTRPCError(result.error);
};
