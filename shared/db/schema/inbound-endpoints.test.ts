import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { inboundEndpoints, inboundLeadReceipts } from "./inbound-endpoints";

describe("inbound schema", () => {
  it("inbound_endpoints has org_id, channel, token, last_lead_at, soft-delete + unique keys", () => {
    const t = getTableConfig(inboundEndpoints);
    const cols = t.columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "token", "last_lead_at", "created_at", "deleted_at"]));
    expect(t.uniqueConstraints.length + t.indexes.length).toBeGreaterThan(0);
  });

  it("inbound_lead_receipts has the (org_id, channel, external_id) idempotency shape", () => {
    const cols = getTableConfig(inboundLeadReceipts).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "org_id", "channel", "external_id", "lead_id", "created_at"]));
  });
});
