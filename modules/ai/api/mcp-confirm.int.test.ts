import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal } from "@mallet/identity";
import { MAX_PENDING_PROPOSALS } from "../infra/confirmation-store";
import { callToolForPrincipal } from "./mcp-server";

// Capstone for the propose→confirm gate on mutating MCP tools (ADR 0007), against live RLS:
// the full lifecycle (propose freezes args+fingerprint, confirm executes exactly once), plus every
// refusal edge the design promises — single-use, expiry, cross-org (RLS), cross-principal
// (created_by binding), frozen args beating resent args, and entity-drift (fingerprint) refusal.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const deps = { clock: systemClock, ids: uuidGenerator, notificationSender: undefined, paymentLinkGateway: null };
const LINES = [{ description: "Labor", quantity: 2, rateCents: 15000 }];

const textOf = (res: { content: unknown }): string => JSON.stringify(res.content);
const tokenFrom = (res: { content: unknown }): string => {
  const match = textOf(res).match(/mallet_confirm_[0-9a-f]+/);
  if (!match) throw new Error(`no confirm token in: ${textOf(res)}`);
  return match[0];
};

suite("MCP propose→confirm gate for mutating tools (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let principal: Principal;

  const estimateCount = async (orgId: string): Promise<number> => {
    const rows = await admin<{ id: string }[]>`select id from estimates where org_id = ${orgId}`;
    return rows.length;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('Confirm A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('Confirm B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Karen Confirm') returning id`;
    leadAId = la!.id;
    principal = { userId: asUserId(randomUUID()), orgId: asOrgId(orgAId), role: "owner" };
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id = ${orgAId}`;
    if (orgBId) await admin`delete from orgs where id = ${orgBId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("propose: freezes args + fingerprint, mints a token, and takes NO action (non-error result)", async () => {
    const res = await callToolForPrincipal(principal, deps, "quote_draft", { leadId: leadAId, lines: LINES });

    expect(res.isError).toBeFalsy(); // a proposal is the expected first step, not an error
    expect(textOf(res)).toContain("NO ACTION TAKEN");
    expect(textOf(res)).toContain("$300.00"); // human summary shows the subtotal
    const token = tokenFrom(res);

    expect(await estimateCount(orgAId)).toBe(0); // nothing executed
    const rows = await admin<{ tool: string; fingerprint: string | null; args: unknown; token_hash: string }[]>`
      select tool, fingerprint, args, token_hash from tool_confirmations where org_id = ${orgAId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tool).toBe("quote_draft");
    expect(rows[0]!.fingerprint).toContain("Karen Confirm"); // entity snapshot taken
    expect(rows[0]!.token_hash).toBe(createHash("sha256").update(token).digest("hex")); // hash at rest, raw never stored
  });

  it("confirm: executes the FROZEN args exactly once; the token is single-use", async () => {
    const proposal = await callToolForPrincipal(principal, deps, "quote_draft", { leadId: leadAId, lines: LINES });
    const token = tokenFrom(proposal);

    // Confirm with DIFFERENT args resent — the frozen $300 proposal must win over the resent $99,999.
    const confirmed = await callToolForPrincipal(principal, deps, "quote_draft", {
      confirmToken: token,
      leadId: leadAId,
      lines: [{ description: "Bait and switch", quantity: 1, rateCents: 9_999_900 }],
    });
    expect(confirmed.isError).toBeFalsy();
    expect(textOf(confirmed)).toContain("$300.00"); // executed the stored args

    const [est] = await admin<{ id: string }[]>`select id from estimates where org_id = ${orgAId} order by created_at desc limit 1`;
    const lines = await admin<{ rate_cents: number }[]>`select rate_cents from estimate_lines where org_id = ${orgAId} and estimate_id = ${est!.id}`;
    expect(lines.every((l) => l.rate_cents === 15000)).toBe(true);

    // Single-use: the same token again is refused, and no second estimate appears.
    const before = await estimateCount(orgAId);
    const replay = await callToolForPrincipal(principal, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(replay.isError).toBe(true);
    expect(textOf(replay)).toContain("invalid or expired");
    expect(await estimateCount(orgAId)).toBe(before);
  });

  it("refuses an expired token", async () => {
    const proposal = await callToolForPrincipal(principal, deps, "quote_draft", { leadId: leadAId, lines: LINES });
    const token = tokenFrom(proposal);
    await admin`update tool_confirmations set expires_at = now() - interval '1 second'
      where token_hash = ${createHash("sha256").update(token).digest("hex")}`;

    const res = await callToolForPrincipal(principal, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("invalid or expired");
  });

  it("refuses a token from another org (RLS) and from another principal in the SAME org (created_by binding)", async () => {
    const proposal = await callToolForPrincipal(principal, deps, "quote_draft", { leadId: leadAId, lines: LINES });
    const token = tokenFrom(proposal);
    const before = await estimateCount(orgAId);

    // Org B holds the raw token — RLS makes it match nothing in B's tenant scope.
    const orgB: Principal = { userId: asUserId(randomUUID()), orgId: asOrgId(orgBId), role: "owner" };
    const cross = await callToolForPrincipal(orgB, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(cross.isError).toBe(true);
    expect(await estimateCount(orgBId)).toBe(0);

    // A sibling key in org A didn't propose it — created_by binding refuses.
    const sibling: Principal = { userId: asUserId(randomUUID()), orgId: asOrgId(orgAId), role: "office" };
    const stolen = await callToolForPrincipal(sibling, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(stolen.isError).toBe(true);
    expect(await estimateCount(orgAId)).toBe(before); // never executed
  });

  it("refuses to execute when the referenced entity changed after the proposal (fingerprint drift)", async () => {
    const proposal = await callToolForPrincipal(principal, deps, "quote_draft", { leadId: leadAId, lines: LINES });
    const token = tokenFrom(proposal);
    const before = await estimateCount(orgAId);

    await admin`update leads set name = 'Karen RENAMED' where id = ${leadAId}`;
    const res = await callToolForPrincipal(principal, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("changed");
    expect(await estimateCount(orgAId)).toBe(before);

    // Stale approvals don't get retries: the token was consumed by the refusal.
    const retry = await callToolForPrincipal(principal, deps, "quote_draft", { confirmToken: token, leadId: leadAId, lines: LINES });
    expect(textOf(retry)).toContain("invalid or expired");
    await admin`update leads set name = 'Karen Confirm' where id = ${leadAId}`; // restore for other tests
  });

  it("caps outstanding proposals per key", async () => {
    const griefer: Principal = { userId: asUserId(randomUUID()), orgId: asOrgId(orgAId), role: "owner" };
    // Seed the cap directly (cheaper than N propose round-trips).
    for (let i = 0; i < MAX_PENDING_PROPOSALS; i++) {
      await admin`insert into tool_confirmations (org_id, token_hash, tool, args, summary, created_by, expires_at)
        values (${orgAId}, ${randomUUID()}, 'quote_draft', '{}', 'seed', ${griefer.userId}, now() + interval '3 minutes')`;
    }
    const res = await callToolForPrincipal(griefer, deps, "quote_draft", { leadId: leadAId, lines: LINES });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("too many pending proposals");
  });
});
