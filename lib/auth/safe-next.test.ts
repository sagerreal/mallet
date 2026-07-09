import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

const DEFAULT = "/auth/set-password";

describe("safeNext", () => {
  it("returns a safe relative path unchanged", () => {
    expect(safeNext("/dashboard", DEFAULT)).toBe("/dashboard");
    expect(safeNext("/reset-password", DEFAULT)).toBe("/reset-password");
    expect(safeNext("/my-day", DEFAULT)).toBe("/my-day");
  });

  it("returns the default when next is null or undefined", () => {
    expect(safeNext(null, DEFAULT)).toBe(DEFAULT);
    expect(safeNext(undefined, DEFAULT)).toBe(DEFAULT);
  });

  it("returns the default when next is an empty string", () => {
    expect(safeNext("", DEFAULT)).toBe(DEFAULT);
  });

  it("blocks protocol-relative URLs (//evil.com)", () => {
    expect(safeNext("//evil.com", DEFAULT)).toBe(DEFAULT);
    expect(safeNext("//evil.com/path", DEFAULT)).toBe(DEFAULT);
  });

  it("blocks absolute URLs with scheme", () => {
    expect(safeNext("https://evil.com", DEFAULT)).toBe(DEFAULT);
    expect(safeNext("http://evil.com/login", DEFAULT)).toBe(DEFAULT);
    expect(safeNext("ftp://files.example.com", DEFAULT)).toBe(DEFAULT);
  });

  it("blocks paths that contain a colon (data:, javascript:)", () => {
    expect(safeNext("javascript:alert(1)", DEFAULT)).toBe(DEFAULT);
    expect(safeNext("data:text/html,<h1>xss</h1>", DEFAULT)).toBe(DEFAULT);
    // Colons in a path segment are also rejected (over-blocks, but safe)
    expect(safeNext("/path:weird", DEFAULT)).toBe(DEFAULT);
  });

  it("blocks paths that do not start with /", () => {
    expect(safeNext("evil.com", DEFAULT)).toBe(DEFAULT);
    expect(safeNext("relative/path", DEFAULT)).toBe(DEFAULT);
  });

  it("returns a custom default when provided", () => {
    expect(safeNext(null, "/login")).toBe("/login");
    expect(safeNext("//bad", "/login")).toBe("/login");
  });
});
