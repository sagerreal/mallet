import { TRPCError } from "@trpc/server";
import type { AppError, Result } from "@mallet/shared/types";
import { APP_ERROR_FIELD } from "@/lib/trpc/error-map";

const CODE_BY_KIND: Record<AppError["kind"], TRPCError["code"]> = {
  validation: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  unauthorized: "UNAUTHORIZED",
  external_service: "BAD_GATEWAY",
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

// Unwrap a use-case Result at the API boundary: success value through, AppError mapped to the
// right tRPC/HTTP status. Keeps domain errors out of the transport layer.
export const orThrow = <T>(result: Result<T, AppError>): T => {
  if (result.ok) return result.value;
  throw toTRPCError(result.error);
};
