import { describe, it, expect } from "vitest";
import type { Result } from "./result";
import { ok, err, isOk, isErr, map, unwrapOr } from "./result";

describe("Result", () => {
  it("ok carries the value", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it("err carries the error", () => {
    const result = err("bad");
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error).toBe("bad");
  });

  it("map transforms an ok value", () => {
    const result = map(ok(2), (n) => n * 3);
    expect(unwrapOr(result, 0)).toBe(6);
  });

  it("map passes an err through unchanged", () => {
    const input: Result<number, string> = err("e");
    const result = map(input, (n: number) => n * 3);
    expect(unwrapOr(result, -1)).toBe(-1);
  });
});
