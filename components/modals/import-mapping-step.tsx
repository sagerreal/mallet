"use client";

/**
 * The mapping step of an import: header→field selectors, the ready/skipped/warning counts, and
 * the step-terminal action. Split out of ImportModal so each stays within the complexity budget
 * and the flow file reads as a state machine rather than a wall of markup.
 */

import type { BuildResult, ImportDescriptor, MappingConfig } from "@/lib/import/engine/descriptor";
import { ImportPill, IMPORT_SELECT_STYLE } from "./import-shared";
import { SelectMenu } from "@/components/ui/select-menu";

interface Props {
  readonly descriptor: ImportDescriptor;
  readonly headers: readonly string[];
  readonly mapping: MappingConfig;
  readonly built: BuildResult;
  readonly skipReason: string;
  readonly importLabel: (count: number) => string;
  readonly resumeFrom: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSetField: (key: string, value: string) => void;
  readonly onBack: () => void;
  readonly onImport: () => void;
}

const LABEL_STYLE = {
  width: 96,
  fontSize: "var(--type-base)",
  fontWeight: 700,
  color: "var(--ink-2)",
} as const;

const ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-3) var(--space-4)",
} as const;

export function ImportMappingStep({
  descriptor, headers, mapping, built, skipReason, importLabel,
  resumeFrom, busy, error, onSetField, onBack, onImport,
}: Props) {
  // Every field, with any combinesWith partner directly after its primary, so "Name" and
  // "Last name" sit together the way a user expects to see them.
  const rows = descriptor.fields.flatMap((f) =>
    f.combinesWith
      ? [{ key: f.key, label: f.label }, { key: f.combinesWith.key, label: f.combinesWith.label }]
      : [{ key: f.key, label: f.label }],
  );

  const constant = descriptor.constant;

  return (
    <>
      <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-1)" }}>
        We matched your columns to Mallet fields — adjust any that look wrong.
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", margin: "var(--space-3) 0 var(--space-4)" }}>
        <ImportPill tone="ready" label={`${built.rows.length} ready`} />
        {built.skipped.length > 0 && (
          <ImportPill tone="skipped" label={`${built.skipped.length} skipped — ${skipReason}`} />
        )}
        {built.warnings.length > 0 && (
          <ImportPill tone="warn" label={`${built.warnings.length} to import without a bad field`} />
        )}
      </div>

      <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {rows.map((row, i) => (
          <div key={row.key} style={{ ...ROW_STYLE, borderTop: i === 0 ? "none" : "1px solid var(--manila-line)" }}>
            <span style={LABEL_STYLE}>{row.label}</span>
            <SelectMenu
              value={mapping[row.key] ?? ""}
              onChange={(v) => onSetField(row.key, v)}
              options={[{ value: "", label: "— skip —" }, ...headers.map((h) => ({ value: h, label: h }))]}
              // Same words as the visible span beside it, so the accessible name and the on-screen
              // name agree. These rows are generated in a map, so a per-row useFieldId is not
              // available without extracting a component.
              aria-label={row.label}
              style={IMPORT_SELECT_STYLE}
              compact
            />
          </div>
        ))}

        {constant && (
          <label style={{ ...ROW_STYLE, borderTop: "1px solid var(--manila-line)", background: "var(--manila)" }}>
            <span style={LABEL_STYLE}>{constant.label}</span>
            <input
              value={typeof mapping[constant.key] === "string" ? (mapping[constant.key] as string) : ""}
              maxLength={constant.maxLength}
              onChange={(e) => onSetField(constant.key, e.target.value)}
              style={{ ...IMPORT_SELECT_STYLE }}
            />
          </label>
        )}
      </div>

      {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: "0" }}>{error}</p>}

      {/* The step-terminal action, docked where the thumb is (sheet grammar). */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <button type="button" className="btn ghost" onClick={onBack}>← Choose a different file</button>
        <button
          type="button"
          className="sheet-pri"
          style={{ flex: 1, width: "auto" }}
          disabled={built.rows.length === 0 || busy}
          onClick={onImport}
        >
          {resumeFrom > 0
            ? `Resume — ${built.rows.length - resumeFrom} left`
            : importLabel(built.rows.length)}
        </button>
      </div>
    </>
  );
}
