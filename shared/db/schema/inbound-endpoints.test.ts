import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { inboundEndpoints, inboundLeadReceipts } from "./inbound-endpoints";

describe("inbound schema", () => {
  it("inbound_endpoints has org_id, channel, token, last_lead_at, soft-delete + named unique/check keys", () => {
    const t = getTableConfig(inboundEndpoints);
    const cols = t.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "token", "last_lead_at", "created_at", "deleted_at"]));
    const uqNames = t.uniqueConstraints.map((u) => u.name);
    expect(uqNames).toEqual(expect.arrayContaining(["inbound_endpoints_org_channel_uq", "inbound_endpoints_token_uq"]));
    const ckNames = t.checks.map((c) => c.name);
    expect(ckNames).toContain("inbound_endpoints_channel_check");
  });

  it("inbound_lead_receipts has the (org_id, channel, external_id) idempotency shape + channel check", () => {
    const t = getTableConfig(inboundLeadReceipts);
    const cols = t.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "external_id", "lead_id", "created_at"]));
    const rUq = t.uniqueConstraints.map((u) => u.name);
    expect(rUq).toContain("inbound_receipts_dedupe_uq");
    const rCk = t.checks.map((c) => c.name);
    expect(rCk).toContain("inbound_receipts_channel_check");
  });
});
