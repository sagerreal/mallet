import { describe, it, expect } from "vitest";
import { runWithContext, getRequestContext, enrichRequestContext } from "./request-context";

describe("request context", () => {
  it("exposes the active context inside a scope", () => {
    runWithContext({ requestId: "r1" }, () => {
      expect(getRequestContext()?.requestId).toBe("r1");
    });
  });

  it("returns undefined outside any scope", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it("enriches the active context in place", () => {
    runWithContext({ requestId: "r2" }, () => {
      enrichRequestContext({ orgId: "org-9", userId: "user-9" });
      expect(getRequestContext()).toMatchObject({ requestId: "r2", orgId: "org-9", userId: "user-9" });
    });
  });

  it("enrich is a no-op outside a scope", () => {
    enrichRequestContext({ orgId: "x" });
    expect(getRequestContext()).toBeUndefined();
  });
});
