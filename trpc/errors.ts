import { TRPCError } from "@trpc/server";
import type { AppError, Result } from "@mallet/shared/types";

const CODE_BY_KIND: Record<AppError["kind"], TRPCError["code"]> = {
  validation: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  unauthorized: "UNAUTHORIZED",
  external_service: "BAD_GATEWAY",
};

export const toTRPCError = (error: AppError): TRPCError =>
  new TRPCError({ code: CODE_BY_KIND[error.kind], message: error.message });

// Unwrap a use-case Result at the API boundary: success value through, AppError mapped to the
// right tRPC/HTTP status. Keeps domain errors out of the transport layer.
export const orThrow = <T>(result: Result<T, AppError>): T => {
  if (result.ok) return result.value;
  throw toTRPCError(result.error);
};
