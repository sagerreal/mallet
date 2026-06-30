import { describe, it, expect } from "vitest";
import { withTimeout } from "./timeout";
import { TimeoutError } from "./errors";

describe("withTimeout", () => {
  it("resolves when the operation finishes before the deadline", async () => {
    await expect(withTimeout(async () => "ok", 50)).resolves.toBe("ok");
  });

  it("rejects with TimeoutError when the deadline passes", async () => {
    await expect(
      withTimeout(() => new Promise((resolve) => setTimeout(() => resolve("late"), 100)), 20),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("aborts the signal on timeout for cooperative cancellation", async () => {
    let aborted = false;
    await withTimeout((signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise((resolve) => setTimeout(resolve, 100));
    }, 20).catch(() => undefined);
    expect(aborted).toBe(true);
  });
});
