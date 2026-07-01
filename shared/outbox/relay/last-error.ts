import type { AppError } from "@mallet/shared/types";

// Maps a dispatch failure to a SAFE, low-cardinality discriminator for the outbox.last_error column.
// NEVER returns the provider's free text, a recipient, or a message body — last_error is for triage
// ("why is this row stuck"), not for reconstructing PII. An AppError becomes its kind (or
// `external_service:<service>` so an ops query can see which dependency is failing); a thrown value
// becomes the fixed string "unhandled".
export const safeLastError = (outcome: { kind: "apperror"; error: AppError } | { kind: "threw" }): string => {
  if (outcome.kind === "threw") return "unhandled";
  const e = outcome.error;
  return e.kind === "external_service" ? `external_service:${e.service}` : e.kind;
};
