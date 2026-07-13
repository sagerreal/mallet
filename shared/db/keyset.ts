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
