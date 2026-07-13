import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { companies } from "@mallet/shared/db/schema";
import { keysetBefore, keysetAfter } from "./keyset";

// Regression test for the page-2 crash: postgres.js cannot bind a JS Date inside a row-value
// tuple. Compile each fragment through PgDialect (no live connection needed) and assert the
// bound param is the ISO string, never a Date instance — that's exactly what postgres.js
// rejects with `TypeError: The "string" argument must be of type string... Received an
// instance of Date`.
const dialect = new PgDialect();
const cursor = { createdAt: new Date("2026-06-30T12:00:00.000Z"), id: "11111111-1111-1111-1111-111111111111" };

describe("keysetBefore", () => {
  it("binds the cursor's createdAt as an ISO string, not a Date", () => {
    const { sql, params } = dialect.sqlToQuery(
      keysetBefore(companies.createdAt, companies.id, cursor),
    );
    expect(sql).toContain("<");
    expect(params).toContain(cursor.createdAt.toISOString());
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });
});

describe("keysetAfter", () => {
  it("binds the cursor's createdAt as an ISO string, not a Date", () => {
    const { sql, params } = dialect.sqlToQuery(
      keysetAfter(companies.createdAt, companies.id, cursor),
    );
    expect(sql).toContain(">");
    expect(params).toContain(cursor.createdAt.toISOString());
    expect(params.some((p) => p instanceof Date)).toBe(false);
  });
});
