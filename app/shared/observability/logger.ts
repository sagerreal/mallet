import pino, { type DestinationStream, type Logger } from "pino";
import { getRequestContext } from "./request-context";

// Fields scrubbed from every log line — PII and credentials must never reach logs.
const REDACT_PATHS = [
  "phone",
  "email",
  "password",
  "token",
  "accessToken",
  "authorization",
  "*.phone",
  "*.email",
  "*.password",
  "*.token",
  "*.accessToken",
];

// Structured JSON logger. `mixin` injects the ambient request context (request_id/org_id/user_id)
// into every line, so logs are correlated and tenant-attributed without per-call plumbing.
// `destination` is injectable for tests.
export const createLogger = (destination?: DestinationStream): Logger =>
  pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      mixin() {
        const context = getRequestContext();
        if (!context) return {};
        return {
          request_id: context.requestId,
          org_id: context.orgId,
          user_id: context.userId,
        };
      },
    },
    destination,
  );

export const logger = createLogger();
