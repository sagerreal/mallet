import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import { hashApiKey } from "@mallet/identity";
import type { Principal } from "@mallet/identity";
import { callToolForPrincipal } from "./mcp-server";
import { POST } from "@/app/mcp/route";

// Capstone for the remote MCP server: tenant-scoped tool execution (the security-critical path) via
// callToolForPrincipal against live RLS, plus the route's auth gate. The MCP JSON-RPC protocol
// handshake itself is thin SDK glue exercised by real clients; here we lock the parts we own.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const RAW_KEY = `mallet_sk_${randomUUID().replace(/-/g, "")}`;
const deps = { clock: systemClock, ids: uuidGenerator, notificationSender: undefined, paymentLinkGateway: null };

suite("remote MCP server (tools + auth, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let principal: Principal;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('MCP A ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    await admin`insert into leads (org_id, name) values (${orgAId}, 'Karen MCP')`;
    await admin`insert into api_keys (org_id, hashed_key, role, label) values (${orgAId}, ${hashApiKey(RAW_KEY)}, 'owner', 'test')`;
    principal = { userId: asUserId(randomUUID()), orgId: asOrgId(orgAId), role: "owner" };
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id = ${orgAId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("runs a read tool under the principal's org (RLS-scoped)", async () => {
    const res = await callToolForPrincipal(principal, deps, "customer_list", {});
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).toContain("Karen MCP");
  });

  it("does NOT expose mutating tools over MCP (they resolve to an unknown-tool error)", async () => {
    const res = await callToolForPrincipal(principal, deps, "quote_draft", {}); // mutating:true → not exposed
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("unknown tool");
  });

  it("returns an isError result for an unknown tool", async () => {
    const res = await callToolForPrincipal(principal, deps, "does_not_exist", {});
    expect(res.isError).toBe(true);
  });

  it("route rejects a request with no/invalid Bearer key (401), accepts a valid one past auth", async () => {
    const post = (headers: Record<string, string>) =>
      POST(new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }));

    expect((await post({})).status).toBe(401); // no credential
    expect((await post({ authorization: "Bearer mallet_sk_wrong" })).status).toBe(401); // unknown key
    // A valid key gets PAST auth (the empty body then fails MCP validation, so anything but 401 proves auth passed).
    expect((await post({ authorization: `Bearer ${RAW_KEY}` })).status).not.toBe(401);
  });
});
