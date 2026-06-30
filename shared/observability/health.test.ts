import { describe, it, expect } from "vitest";
import { liveness, readiness } from "./health";

describe("liveness", () => {
  it("is always ok", () => {
    expect(liveness()).toEqual({ status: "ok" });
  });
});

describe("readiness", () => {
  it("is ok when the dependency probe succeeds", async () => {
    const report = await readiness(async () => undefined);
    expect(report.status).toBe("ok");
    expect(report.checks?.database?.ok).toBe(true);
  });

  it("is error when the dependency probe throws", async () => {
    const report = await readiness(async () => {
      throw new Error("connection refused");
    });
    expect(report.status).toBe("error");
    expect(report.checks?.database).toEqual({ ok: false, error: "connection refused" });
  });
});
