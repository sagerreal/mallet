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
// The quoting barrel now re-exports the public-quote reader, whose module pulls the owner (BYPASSRLS)
// db client — its init calls loadConfig() (secretful). Stub it so this stays hermetic; withTenant
// (mocked above) is the only DB seam the tool path actually touches.
vi.mock("@mallet/shared/db/owner-client", () => ({ ownerDb: {}, closeOwnerDb: async () => {} }));

import { withTenant } from "@mallet/shared/db/tx";
import { callToolForPrincipal } from "./mcp-server";

const principalWith = (role: Principal["role"]): Principal => ({ userId: asUserId(randomUUID()), orgId: asOrgId(randomUUID()), role });
const deps = { clock: systemClock, ids: uuidGenerator, notificationSender: undefined, paymentLinkGateway: null };

describe("callToolForPrincipal gating + error containment (hermetic)", () => {
  it("rejects a tech-role key BEFORE any DB work — on a read tool and on both legs of a mutating tool", async () => {
    vi.mocked(withTenant).mockClear();
    const tech = principalWith("tech");

    for (const call of [
      callToolForPrincipal(tech, deps, "customer_list", {}),
      callToolForPrincipal(tech, deps, "quote_draft", {}), // propose leg
      callToolForPrincipal(tech, deps, "quote_draft", { confirmToken: "mallet_confirm_x" }), // confirm leg
    ]) {
      const res = await call;
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("role");
    }
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("maps an unexpected throw inside withTenant to a GENERIC isError result — never leaking the raw message", async () => {
    const RAW = 'error: relation "leads" does not exist (SQLSTATE 42P01)';
    vi.mocked(withTenant).mockRejectedValueOnce(new Error(RAW));

    const res = await callToolForPrincipal(principalWith("owner"), deps, "customer_list", {});

    expect(res.isError).toBe(true);
    // Exactly the generic text — the SDK would otherwise echo error.message verbatim to the host.
    expect(res.content).toEqual([{ type: "text", text: "internal error executing tool" }]);
    const serialized = JSON.stringify(res.content);
    expect(serialized).not.toContain("SQLSTATE");
    expect(serialized).not.toContain("leads");
    expect(serialized).not.toContain("relation");
  });

  it("contains an unexpected throw on the MUTATING (propose) path to the same generic isError", async () => {
    vi.mocked(withTenant).mockRejectedValueOnce(new Error("connection terminated unexpectedly"));

    const res = await callToolForPrincipal(principalWith("owner"), deps, "quote_draft", { leadId: randomUUID(), lines: [] });

    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "internal error executing tool" }]);
  });

  it("rejects a non-string confirmToken without touching the DB seam", async () => {
    vi.mocked(withTenant).mockClear();
    const res = await callToolForPrincipal(principalWith("owner"), deps, "quote_draft", { confirmToken: 5 });

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("confirmToken must be a string");
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("returns an unknown-tool isError WITHOUT touching the DB seam", async () => {
    vi.mocked(withTenant).mockClear();
    const res = await callToolForPrincipal(principalWith("owner"), deps, "does_not_exist", {});

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("unknown tool");
    expect(withTenant).not.toHaveBeenCalled();
  });
});
