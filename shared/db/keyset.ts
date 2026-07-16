import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Cursor } from "@mallet/shared/types";

// Keyset (cursor) pagination comparison, shared by every paginated Drizzle repository.
//
// The bug this fixes: postgres.js cannot bind a JS `Date` inside a row-value tuple —
// `(col, col) < (val, val)` — it throws `TypeError: The "string" argument must be of type
// string... Received an instance of Date`. So any inline `sql\`... < (${cursor.createdAt}::
// timestamptz, ...)\`` crashes the moment there's a page 2. Passing `createdAt.toISOString()`
// (a string) instead of the raw Date avoids that; the comparison is otherwise identical.
//
// Two directions because the codebase paginates both ways: descending lists (most recent
// first) want rows strictly BEFORE the cursor; ascending lists (e.g. due-date queues) want
// rows strictly AFTER it.

// Descending lists ordered by (createdAtCol desc, idCol desc): rows strictly before the cursor.
export const keysetBefore = (
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: Cursor,
): SQL =>
  sql`(${createdAtCol}, ${idCol}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;

// Ascending lists ordered by (createdAtCol asc, idCol asc): rows strictly after the cursor.
export const keysetAfter = (
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: Cursor,
): SQL =>
  sql`(${createdAtCol}, ${idCol}) > (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;

// Three-column ascending keyset for lists ordered by (dueDateCol asc nulls last, createdAtCol asc, idCol asc).
// NULL dueDates sort LAST; once dueDate is null in the cursor, we only need createdAt+id to distinguish rows.
// Row-value comparison: (dueDate, createdAt, id) > cursor — with NULLS LAST semantics via CASE:
//   any non-null dueDate > null cursor.dueDate; null dueDate rows come after all dated rows.
export const keysetAfterDueDate = (
  dueDateCol: AnyPgColumn,
  createdAtCol: AnyPgColumn,
  idCol: AnyPgColumn,
  cursor: { dueDate: string | null; createdAt: Date; id: string },
): SQL => {
  const createdAtIso = cursor.createdAt.toISOString();
  if (cursor.dueDate === null) {
    // Cursor is in the null-dueDate zone: only rows after this createdAt+id within nulls
    return sql`(${dueDateCol} is null and (${createdAtCol}, ${idCol}) > (${createdAtIso}::timestamptz, ${cursor.id}::uuid))`;
  }
  // Cursor has a dueDate: rows after = later dueDate OR same dueDate with later (createdAt, id) OR null dueDate
  return sql`(
    ${dueDateCol} > ${cursor.dueDate}::date
    or (${dueDateCol} = ${cursor.dueDate}::date and (${createdAtCol}, ${idCol}) > (${createdAtIso}::timestamptz, ${cursor.id}::uuid))
    or ${dueDateCol} is null
  )`;
};
