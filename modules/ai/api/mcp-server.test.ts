import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";

// withTenant is the only DB seam callToolForPrincipal touches; mocking it keeps this hermetic (no
// live DB) while letting us drive the UNEXPECTED-throw path — the one the int test can't reach.
vi.mock("@mallet/shared/db/tx", () => ({ withTenant: vi.fn() }));
// The outbox barrel re-exports the relay, whose module init calls loadConfig() (secretful) — stub it
// so this stays hermetic. The bus is only constructed inside the withTenant callback, which the mock
// above never invokes, so the stub is never actually used.
vi.mock("@mallet/shared/outbox", () => ({ OutboxEventBus: class {} }));

import { withTenant } from "@mallet/shared/db/tx";
import { callToolForPrincipal } from "./mcp-server";

const principal: Principal = { userId: asUserId(randomUUID()), orgId: asOrgId(randomUUID()), role: "owner" };
const deps = { clock: systemClock, ids: uuidGenerator, notificationSender: undefined, paymentLinkGateway: null };

describe("callToolForPrincipal error containment (hermetic)", () => {
  it("maps an unexpected throw inside withTenant to a GENERIC isError result — never leaking the raw message", async () => {
    const RAW = 'error: relation "leads" does not exist (SQLSTATE 42P01)';
    vi.mocked(withTenant).mockRejectedValueOnce(new Error(RAW));

    const res = await callToolForPrincipal(principal, deps, "customer_list", {});

    expect(res.isError).toBe(true);
    // Exactly the generic text — the SDK would otherwise echo error.message verbatim to the host.
    expect(res.content).toEqual([{ type: "text", text: "internal error executing tool" }]);
    const serialized = JSON.stringify(res.content);
    expect(serialized).not.toContain("SQLSTATE");
    expect(serialized).not.toContain("leads");
    expect(serialized).not.toContain("relation");
  });

  it("returns an unknown-tool isError for a mutating (not-exposed) tool WITHOUT touching the DB seam", async () => {
    vi.mocked(withTenant).mockClear();
    const res = await callToolForPrincipal(principal, deps, "quote_draft", {});

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("unknown tool");
    expect(withTenant).not.toHaveBeenCalled();
  });
});
