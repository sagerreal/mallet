import { describe, it, expect } from "vitest";
import { InboundEndpoint } from "./inbound-endpoint";
import { isOk, isErr, asOrgId } from "@mallet/shared/types";

const base = {
  id: "11111111-1111-1111-1111-111111111111",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  channel: "form" as const,
  token: "a".repeat(64),
  lastLeadAt: null,
  createdAt: new Date("2026-07-12T00:00:00Z"),
};

describe("InboundEndpoint.create", () => {
  it("accepts a valid endpoint", () => {
    expect(isOk(InboundEndpoint.create(base))).toBe(true);
  });
  it("rejects a bad channel", () => {
    expect(isErr(InboundEndpoint.create({ ...base, channel: "sms" as never }))).toBe(true);
  });
  it("rejects a token that is not 64 hex chars", () => {
    expect(isErr(InboundEndpoint.create({ ...base, token: "short" }))).toBe(true);
  });
  it("reports connected only when lastLeadAt is set", () => {
    const off = InboundEndpoint.create(base);
    const on = InboundEndpoint.create({ ...base, lastLeadAt: new Date() });
    if (isOk(off) && isOk(on)) {
      expect(off.value.isConnected).toBe(false);
      expect(on.value.isConnected).toBe(true);
    }
  });
});
