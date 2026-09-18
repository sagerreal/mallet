import type { ValidationError } from "./errors";
import { validation } from "./errors";
import type { Result } from "./result";
import { ok, err } from "./result";

// Keyset (cursor) pagination — no OFFSET. Lists order by (created_at desc, id desc),
// and the cursor carries the last row's (createdAt, id) so the next page is an index
// range scan rather than a count-and-skip.

export const DEFAULT_PAGE_SIZE = 25;
// 500 matches HYDRATOR_PAGE_LIMIT (lib/store/hydrator-config.ts) — orgs up to 500 records
// are fully hydrated in one pass without silent truncation.
export const MAX_PAGE_SIZE = 500;

export interface CursorPage {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

// Clamp an untrusted page request to a sane size.
export const toPage = (input?: { limit?: number; cursor?: string | null }): CursorPage => {
  const requested = input?.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_SIZE);
  return { limit, cursor: input?.cursor ?? null };
};

export const encodeCursor = (c: Cursor): string =>
  Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf8").toString("base64url");

export const decodeCursor = (raw: string): Result<Cursor, ValidationError> => {
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  if (sep <= 0) return err(validation("malformed cursor", "cursor"));
  const createdAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    return err(validation("malformed cursor", "cursor"));
  }
  return ok({ createdAt, id });
};

// Build a page result from one extra-fetched row: query `limit + 1`, and if the extra
// row came back there is a next page whose cursor points at the last returned item.
export const buildPage = <T>(
  rows: readonly T[],
  page: CursorPage,
  toCursor: (row: T) => Cursor,
): Paginated<T> => {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(toCursor(last)) : null;
  return { items, nextCursor };
};

// Generic JSON cursor — encodes an arbitrary serialisable payload.
// Separate from the two-field Cursor so existing repos are unaffected.
export const encodeJsonCursor = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

export const decodeJsonCursor = <T = unknown>(
  raw: string,
): Result<T, ValidationError> => {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    return ok(JSON.parse(decoded) as T);
  } catch {
    return err(validation("malformed cursor", "cursor"));
  }
};

// buildPage variant for callers that carry an arbitrary cursor payload.
export const buildJsonPage = <T, C>(
  rows: readonly T[],
  page: CursorPage,
  toCursor: (row: T) => C,
): Paginated<T> => {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeJsonCursor(toCursor(last)) : null;
  return { items, nextCursor };
};
