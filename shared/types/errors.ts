// One closed set of application errors with a consistent shape — mapped to HTTP/tRPC at the boundary.
export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "external_service"
  | "unauthorized";

interface BaseError {
  readonly kind: ErrorKind;
  readonly message: string;
}

export interface ValidationError extends BaseError {
  readonly kind: "validation";
  readonly field?: string;
}
export interface NotFoundError extends BaseError {
  readonly kind: "not_found";
}
export interface ConflictError extends BaseError {
  readonly kind: "conflict";
  // Optional machine-readable tag, same contract as a validation error's `field`: it lets a client
  // react to ONE specific refusal without pattern-matching a sentence written for humans.
  readonly field?: string;
}
export interface ExternalServiceError extends BaseError {
  readonly kind: "external_service";
  readonly service: string;
  readonly retryable: boolean;
}
export interface UnauthorizedError extends BaseError {
  readonly kind: "unauthorized";
}

export type AppError =
  | ValidationError
  | NotFoundError
  | ConflictError
  | ExternalServiceError
  | UnauthorizedError;

export const validation = (message: string, field?: string): ValidationError => ({
  kind: "validation",
  message,
  field,
});
export const notFound = (message: string): NotFoundError => ({ kind: "not_found", message });
export const conflict = (message: string, field?: string): ConflictError => ({
  kind: "conflict",
  message,
  field,
});
export const externalService = (
  service: string,
  message: string,
  retryable = true,
): ExternalServiceError => ({ kind: "external_service", service, message, retryable });
export const unauthorized = (message = "unauthorized"): UnauthorizedError => ({
  kind: "unauthorized",
  message,
});
