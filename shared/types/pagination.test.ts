import { describe, it, expect } from "vitest";
import {
  toPage,
  encodeCursor,
  decodeCursor,
  buildPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./pagination";

describe("toPage", () => {
  it("defaults the limit when none is given", () => {
    expect(toPage().limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it("clamps an oversized limit to the maximum", () => {
    expect(toPage({ limit: 10_000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("passes through a limit equal to MAX_PAGE_SIZE (500) unchanged", () => {
    expect(toPage({ limit: 500 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("clamps 501 to MAX_PAGE_SIZE (500)", () => {
    expect(toPage({ limit: 501 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("floors a limit of 0 to at least 1", () => {
    expect(toPage({ limit: 0 }).limit).toBe(1);
  });
});

describe("cursor round-trip", () => {
  it("encodes and decodes a (createdAt, id) pair", () => {
    const createdAt = new Date("2026-06-30T12:00:00.000Z");
    const id = "11111111-1111-1111-1111-111111111111";
    const decoded = decodeCursor(encodeCursor({ createdAt, id }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.id).toBe(id);
      expect(decoded.value.createdAt.toISOString()).toBe(createdAt.toISOString());
    }
  });

  it("rejects a malformed cursor", () => {
    expect(decodeCursor("not-a-real-cursor").ok).toBe(false);
  });
});

describe("buildPage", () => {
  const rows = [
    { id: "a", createdAt: new Date("2026-06-03T00:00:00Z") },
    { id: "b", createdAt: new Date("2026-06-02T00:00:00Z") },
    { id: "c", createdAt: new Date("2026-06-01T00:00:00Z") },
  ];
  const toCursor = (r: { id: string; createdAt: Date }) => r;

  it("returns no next cursor when the extra row is absent", () => {
    const page = buildPage(rows, { limit: 5, cursor: null }, toCursor);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("trims the extra row and emits a next cursor when there is more", () => {
    const page = buildPage(rows, { limit: 2, cursor: null }, toCursor);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const decoded = decodeCursor(page.nextCursor as string);
    expect(decoded.ok && decoded.value.id).toBe("b");
  });
});
