/**
 * lib/import/import-error-message.ts
 *
 * What the import modal shows when a chunk fails.
 *
 * The modal used to render `err.message` straight through. That is fine for the messages the
 * import use-cases actually write, but a tRPC INPUT rejection carries the serialized Zod issue
 * array as its message — so one blank price cell in a supplier sheet put a wall of JSON
 * ("expected": "number", "code": "invalid_type", paths and all) in front of the person importing.
 * A validation failure has to name the columns to look at instead.
 *
 * The server formatter now flattens those issues for every surface (see trpc/errors.ts), so this
 * file keeps only what is specific to importing: copy that names the COLUMNS, which the generic
 * sentence cannot — it sees `rows.12.unitPriceCents`, not the header the person is looking at.
 * Recognising the rejection is the same question everywhere, so it is the shared predicate.
 */

import { isInputValidationError } from "@/lib/trpc/input-validation";

/** Shown when the server rejected the shape of the rows rather than failing partway through. */
export const IMPORT_VALIDATION_COPY =
  "Some rows couldn't be read — check the price and cost columns for anything that isn't a number, then import again.";

/** Shown when the failure wasn't an Error at all, so there is no message to pass on. */
export const IMPORT_STOPPED_COPY =
  "Import stopped partway. Saved rows were kept — click Import to finish the rest.";

/** The sentence to show for a failed import chunk. */
export function importErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return IMPORT_STOPPED_COPY;
  return isInputValidationError(err) ? IMPORT_VALIDATION_COPY : err.message;
}
