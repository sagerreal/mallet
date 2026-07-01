import type { Result, AppError } from "@mallet/shared/types";
import { safeLastError } from "./last-error";

// How the relay should mark a row given the outcome. "publish" stops re-claiming (delivered ok, or a
// terminal/un-processable event); "fail" leaves it unpublished for the next tick (with attempts++).
export type Disposition = { mark: "publish"; lastError: string | null } | { mark: "fail"; lastError: string };

// The pure disposition decision (no I/O), unit-tested:
//  - ok                                    -> publish (delivered).
//  - external_service + retryable          -> fail (transient infra blip; retry next tick).
//  - any other error (validation/not_found/conflict/non-retryable external_service)
//                                          -> publish TERMINAL with a safe reason — retrying would
//                                             fail identically, so stop re-claiming a bad event.
export const dispositionFor = (result: Result<void, AppError>): Disposition => {
  if (result.ok) return { mark: "publish", lastError: null };
  if (result.error.kind === "external_service" && result.error.retryable) {
    return { mark: "fail", lastError: safeLastError({ kind: "apperror", error: result.error }) };
  }
  return { mark: "publish", lastError: safeLastError({ kind: "apperror", error: result.error }) };
};
