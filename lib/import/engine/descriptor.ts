/**
 * The contract every entity importer is configured with.
 *
 * One descriptor per entity replaces a hand-written mapping module. Adding a FIELD is one entry in
 * `fields`; adding an ENTITY is one descriptor plus one server procedure. Neither touches the
 * engine (auto-map, row building, the modal).
 *
 * What a descriptor deliberately CANNOT express: business rules ("a job scheduled in the past is
 * invalid") and cross-entity resolution ("Gary Pratt" → a leadId). Those belong to the domain and
 * the server procedure respectively — a descriptor is a UI convenience, never the validation
 * boundary. The server re-validates every row regardless of what happened in the browser.
 */

/**
 * How a raw CSV cell becomes a typed value. Adding a new kind means writing ONE coercer in
 * coercers.ts; every entity can then use it. See `COERCERS` for the registry.
 */
export type CoercerId =
  | "text"
  | "phone"
  | "email"
  | "money"
  | "integer"
  | "boolean"
  | "enum"
  | "date"
  | "time";

/**
 * What happens to the ROW when a field's value is missing or unreadable.
 *
 * Both existing importers are represented here, and they differ — which is exactly why this is a
 * per-field setting rather than one global rule:
 *   - customers: no name  → the row is SKIPPED (`required`)
 *   - services:  bad price → a WARNING, and the row imports at $0 (`fallback`)
 */
export type OnInvalid =
  /** Drop the row and report it as skipped. Use for fields the row is meaningless without. */
  | { readonly kind: "skip-row"; readonly message: string }
  /** Keep the row, drop the field, warn. The field lands as null. */
  | { readonly kind: "drop-field" }
  /** Keep the row, warn, and substitute a value. `note` names the substitution in the warning. */
  | { readonly kind: "fallback"; readonly value: unknown; readonly note: string };

export interface ImportFieldSpec {
  /** Key on the row object sent to the server. */
  readonly key: string;
  /** Label in the mapping UI. */
  readonly label: string;
  /**
   * Header substrings for auto-mapping, MOST SPECIFIC FIRST — "last name" must be tried before
   * "name", or a "Last name" column gets claimed as the full name.
   */
  readonly synonyms: readonly string[];
  readonly coerce: CoercerId;
  /**
   * True when a blank cell (as opposed to an unreadable one) skips the row. Kept separate from
   * `onInvalid` because "absent" and "present but unparseable" are different failures.
   */
  readonly required?: boolean;
  /** Behaviour when the cell is present but the coercer rejects it. Defaults to drop-field. */
  readonly onInvalid?: OnInvalid;
  /**
   * Client-side clamp mirroring the server's Zod bound. Not cosmetic: an over-long value would
   * reject the WHOLE batch at the server boundary, so the client truncates to keep the
   * "client sends only valid rows" contract.
   */
  readonly maxLength?: number;
  /** `enum` only — lowercased accepted spelling → canonical value. */
  readonly enumValues?: Readonly<Record<string, string>>;
  /**
   * A second header appended to this one, space-joined (First name + Last name → name).
   * The partner field is auto-mapped and offered in the UI but never sent on its own.
   */
  readonly combinesWith?: {
    readonly key: string;
    readonly label: string;
    readonly synonyms: readonly string[];
  };
  /** Value used when the cell is blank and the field is not required. Defaults to null. */
  readonly whenBlank?: unknown;
}

export interface ImportDescriptor {
  /** Stable id, used for the modal's entity switch and Settings → Import. */
  readonly entity: string;
  /** Human label ("Customers"). */
  readonly label: string;
  /** Rows per request. The server caps each call; the modal chunks to this and resumes. */
  readonly chunkSize: number;
  readonly fields: readonly ImportFieldSpec[];
  /**
   * Constant applied to every row (customers stamp a `source` tag). Editable in the UI when
   * `constantLabel` is set. Clamped like any other value — one over-long constant would reject
   * every batch, not one row.
   */
  readonly constant?: {
    readonly key: string;
    readonly label: string;
    readonly defaultValue: string;
    readonly maxLength: number;
  };
  /** Entities that should be imported first. Advisory — surfaced in the UI, never enforced. */
  readonly dependsOn?: readonly string[];
}

/** One row's worth of clean, coerced, server-ready values. */
export type BuiltRow = Record<string, unknown>;

export interface RowIssue {
  readonly rowIndex: number;
  readonly kind: "skipped" | "warning";
  readonly message: string;
}

export interface BuildResult {
  readonly rows: BuiltRow[];
  readonly skipped: RowIssue[];
  readonly warnings: RowIssue[];
}

/**
 * Chosen header for each field key, or null when the user mapped nothing to it.
 * Includes `combinesWith` partner keys and the constant's key (which holds a literal value, not a
 * header name).
 */
export type MappingConfig = Record<string, string | null>;
