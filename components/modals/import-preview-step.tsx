"use client";

/**
 * The confirm step: what this import will actually do, before it does it.
 *
 * The mapping step already counts ready/skipped/warning rows, but a count is not an answer — a
 * shop told "12 skipped" cannot tell whether that is 12 blank trailing rows or 12 real customers
 * about to be lost. This step names them, so the decision to commit is informed.
 *
 * Issues are grouped by MESSAGE rather than listed per row: a mis-mapped column produces the same
 * complaint hundreds of times, and "412 rows: Couldn't read phone" is the useful shape. Row
 * numbers are 1-based and account for the header line, so they match what the user sees in Excel.
 */

import type { BuildResult, RowIssue } from "@/lib/import/engine/descriptor";
import { ImportPill } from "./import-shared";

interface Props {
  readonly built: BuildResult;
  readonly skipReason: string;
  readonly importLabel: (count: number) => string;
  readonly resumeFrom: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}

/** Spreadsheet row number for a 0-based record index: +1 for 1-based, +1 for the header row. */
const sheetRow = (rowIndex: number): number => rowIndex + 2;

interface IssueGroup {
  readonly message: string;
  readonly rows: number[];
}

/** Group issues by message, preserving first-seen order so the commonest problem isn't buried. */
function groupIssues(issues: readonly RowIssue[]): IssueGroup[] {
  const groups = new Map<string, number[]>();
  for (const issue of issues) {
    const rows = groups.get(issue.message);
    if (rows) rows.push(sheetRow(issue.rowIndex));
    else groups.set(issue.message, [sheetRow(issue.rowIndex)]);
  }
  return [...groups].map(([message, rows]) => ({ message, rows }));
}

/** "rows 2, 3, 4" — or "rows 2, 3, 4 and 9 more" once the list stops being readable. */
function describeRows(rows: readonly number[]): string {
  const shown = rows.slice(0, 3).join(", ");
  const rest = rows.length - 3;
  const noun = rows.length === 1 ? "row" : "rows";
  return rest > 0 ? `${noun} ${shown} and ${rest} more` : `${noun} ${shown}`;
}

function IssueList({ title, issues, tone }: { title: string; issues: readonly RowIssue[]; tone: "skipped" | "warn" }) {
  if (issues.length === 0) return null;
  const colour = tone === "skipped" ? "var(--ink-3)" : "var(--amber-ink, var(--ink-2))";

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <h3
        style={{
          fontSize: "var(--type-sm)",
          fontWeight: 700,
          color: "var(--ink-2)",
          margin: "0 0 var(--space-2)",
        }}
      >
        {title}
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
        {groupIssues(issues).map((group) => (
          <li key={group.message} style={{ fontSize: "var(--type-base)", color: colour, lineHeight: 1.45 }}>
            {group.message}{" "}
            <span className="muted">({describeRows(group.rows)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportPreviewStep({
  built, skipReason, importLabel, resumeFrom, busy, error, onBack, onConfirm,
}: Props) {
  const nothingToDo = built.rows.length === 0;

  return (
    <>
      <p
        className="muted"
        style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)", marginBottom: "var(--space-3)" }}
      >
        {nothingToDo
          ? "Nothing here can be imported — every row is missing something required."
          : "Here's what this will do. Nothing has been saved yet."}
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
        <ImportPill tone="ready" label={`${built.rows.length} will import`} />
        {built.skipped.length > 0 && (
          <ImportPill tone="skipped" label={`${built.skipped.length} skipped — ${skipReason}`} />
        )}
        {built.warnings.length > 0 && (
          <ImportPill tone="warn" label={`${built.warnings.length} missing a field`} />
        )}
      </div>

      <IssueList
        title="These rows won't be imported"
        issues={built.skipped}
        tone="skipped"
      />
      <IssueList
        title="These will import, without the field we couldn't read"
        issues={built.warnings}
        tone="warn"
      />

      {error && <p className="auth-error" style={{ marginTop: "var(--space-4)", marginBottom: 0 }}>{error}</p>}

      {/* The step-terminal action, docked where the thumb is (sheet grammar). */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <button type="button" className="btn ghost" onClick={onBack}>← Change the mapping</button>
        <button
          type="button"
          className="sheet-pri"
          style={{ flex: 1, width: "auto" }}
          disabled={nothingToDo || busy}
          onClick={onConfirm}
        >
          {resumeFrom > 0
            ? `Resume — ${built.rows.length - resumeFrom} left`
            : importLabel(built.rows.length)}
        </button>
      </div>
    </>
  );
}
