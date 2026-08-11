/**
 * Apply a mapping to parsed CSV records, producing server-ready rows plus per-row issues.
 *
 * Generalises `buildImportRows` (customers) and `buildServiceImportRows` (services). The
 * three-way classification both established is preserved exactly:
 *
 *   ready    → coerced cleanly, or only had blank optional fields
 *   skipped  → a required field was blank, or a coercion failed with `onInvalid: skip-row`
 *   warning  → a value was present but unreadable; the row STILL IMPORTS, with the field dropped
 *              or replaced by a fallback
 *
 * That warning behaviour is the important one: one malformed email must never reject a batch of
 * eight hundred rows.
 *
 * Clamping is applied to every coerced string, not just `text`, and mirrors the server's Zod
 * bounds. It is not cosmetic — an over-long value would reject the WHOLE batch at the server
 * boundary, so the client truncates to honour "the client sends only valid rows".
 */

import { COERCERS } from "./coercers";
import type {
  BuildResult,
  BuiltRow,
  ImportDescriptor,
  ImportFieldSpec,
  MappingConfig,
  RowIssue,
} from "./descriptor";

function cell(record: Record<string, string>, header: string | null | undefined): string {
  if (!header) return "";
  return (record[header] ?? "").trim();
}

function clamp(value: unknown, maxLength: number | undefined): unknown {
  if (maxLength === undefined || typeof value !== "string") return value;
  return value.slice(0, maxLength);
}

/**
 * Read a field's raw text, joining a `combinesWith` partner when one is mapped
 * (First name + Last name → "Ann Lee"). Either part may be absent.
 */
function rawFor(
  record: Record<string, string>,
  mapping: MappingConfig,
  field: ImportFieldSpec,
): string {
  const primary = cell(record, mapping[field.key]);
  if (!field.combinesWith) return primary;
  const partner = cell(record, mapping[field.combinesWith.key]);
  return [primary, partner].filter(Boolean).join(" ").trim();
}

/** Outcome of reading ONE field: a value to keep, or a reason the whole row is skipped. */
type FieldOutcome =
  | { readonly kind: "value"; readonly value: unknown; readonly warning?: string }
  | { readonly kind: "skip-row"; readonly message: string };

function readField(
  record: Record<string, string>,
  mapping: MappingConfig,
  field: ImportFieldSpec,
): FieldOutcome {
  const raw = rawFor(record, mapping, field);

  // Blank. Required ⇒ the row is meaningless; otherwise take the blank default.
  if (!raw) {
    if (!field.required) return { kind: "value", value: field.whenBlank ?? null };
    return {
      kind: "skip-row",
      message:
        field.onInvalid?.kind === "skip-row"
          ? field.onInvalid.message
          : `No ${field.label.toLowerCase()} — row skipped.`,
    };
  }

  const result = COERCERS[field.coerce](raw, field);
  if (result.ok) return { kind: "value", value: clamp(result.value, field.maxLength) };

  // Present but unreadable. The descriptor decides what that costs the row.
  const onInvalid = field.onInvalid ?? { kind: "drop-field" as const };

  if (onInvalid.kind === "skip-row") return { kind: "skip-row", message: onInvalid.message };

  if (onInvalid.kind === "fallback") {
    return { kind: "value", value: onInvalid.value, warning: `${result.reason} — ${onInvalid.note}` };
  }

  return {
    kind: "value",
    value: field.whenBlank ?? null,
    warning: `${result.reason} — imported without it.`,
  };
}

export function buildRows(
  records: readonly Record<string, string>[],
  mapping: MappingConfig,
  descriptor: ImportDescriptor,
): BuildResult {
  const rows: BuiltRow[] = [];
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  records.forEach((record, rowIndex) => {
    const row: BuiltRow = {};
    const rowWarnings: RowIssue[] = [];
    let skip: RowIssue | null = null;

    for (const field of descriptor.fields) {
      const outcome = readField(record, mapping, field);

      if (outcome.kind === "skip-row") {
        skip = { rowIndex, kind: "skipped", message: outcome.message };
        break;
      }

      row[field.key] = outcome.value;
      if (outcome.warning) {
        rowWarnings.push({ rowIndex, kind: "warning", message: outcome.warning });
      }
    }

    if (skip) {
      skipped.push(skip);
      return;
    }

    if (descriptor.constant) {
      const { key, defaultValue, maxLength } = descriptor.constant;
      const chosen = mapping[key];
      const value = (typeof chosen === "string" ? chosen : defaultValue).trim().slice(0, maxLength);
      row[key] = value || null;
    }

    rows.push(row);
    warnings.push(...rowWarnings);
  });

  return { rows, skipped, warnings };
}
