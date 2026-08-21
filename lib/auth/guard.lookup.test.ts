/**
 * lib/auth/guard.lookup.test.ts
 *
 * "No org" and "no database" are DIFFERENT answers, and the root route sends them to different
 * places. They used to collapse into one `null`, so while the connection pooler was refusing
 * connections a fully provisioned owner was routed to /welcome and shown "Set up your shop" —
 * one press from provisioning a second org and buying it a phone number.
 *
 * The load-bearing case is "the resolver threw" → `unavailable`. If that ever reverts to
 * `unprovisioned`, this suite is the thing that says so.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Principal } from "@mallet/identity";

const verify = vi.fn();
const authenticate = vi.fn();
let sessionToken: string | null = "jwt-token";

vi.mock("@/trpc/di", () => ({
  getAppDeps: () => ({ tokenVerifier: { verify }, authProvider: { authenticate } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: sessionToken === null ? null : { access_token: sessionToken } },
      }),
    },
  }),
}));

vi.mock("@mallet/shared/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { lookupSessionPrincipal, getSessionPrincipal } = await import("./guard");

const principal = { userId: "u1", orgId: "org-1", role: "owner" } as unknown as Principal;

beforeEach(() => {
  verify.mockReset();
  authenticate.mockReset();
  sessionToken = "jwt-token";
});

describe("lookupSessionPrincipal", () => {
  it("is unauthenticated with no session token", async () => {
    sessionToken = null;
    await expect(lookupSessionPrincipal()).resolves.toEqual({ status: "unauthenticated" });
  });

  it("is unauthenticated when the token does not verify", async () => {
    verify.mockResolvedValue(null);
    await expect(lookupSessionPrincipal()).resolves.toEqual({ status: "unauthenticated" });
    expect(authenticate, "a token that failed local verify is not worth a DB round-trip").not.toHaveBeenCalled();
  });

  it("returns the principal for a provisioned account", async () => {
    verify.mockResolvedValue({ authUserId: "auth-1" });
    authenticate.mockResolvedValue({ ok: true, value: principal });
    await expect(lookupSessionPrincipal()).resolves.toEqual({ status: "ok", principal });
  });

  it("is unprovisioned when the account really belongs to no org", async () => {
    verify.mockResolvedValue({ authUserId: "auth-1" });
    authenticate.mockResolvedValue({ ok: false, error: { message: "account is not provisioned in any org" } });
    await expect(lookupSessionPrincipal()).resolves.toEqual({ status: "unprovisioned" });
  });

  // THE REGRESSION. DbPrincipalResolver does not catch, so an unreachable database throws out of
  // authenticate. Reported as: signed in, valid owner, got "Set up your shop".
  it("is unavailable — NOT unprovisioned — when the principal resolver throws", async () => {
    verify.mockResolvedValue({ authUserId: "auth-1" });
    authenticate.mockRejectedValue(
      new Error('connection to server failed: FATAL: Failed to connect to database: {:error, :econnrefused}'),
    );

    const lookup = await lookupSessionPrincipal();

    expect(lookup).toEqual({ status: "unavailable" });
    expect(
      lookup.status,
      "unprovisioned here routes a real owner to /welcome and offers to buy a second phone number",
    ).not.toBe("unprovisioned");
  });

  it("is unavailable when JWKS verification itself throws — a network fault is not a verdict", async () => {
    verify.mockRejectedValue(new Error("getaddrinfo EAI_AGAIN"));
    await expect(lookupSessionPrincipal()).resolves.toEqual({ status: "unavailable" });
  });
});

describe("getSessionPrincipal — the narrow form still behaves", () => {
  it("hands back the principal when there is one", async () => {
    verify.mockResolvedValue({ authUserId: "auth-1" });
    authenticate.mockResolvedValue({ ok: true, value: principal });
    await expect(getSessionPrincipal()).resolves.toEqual(principal);
  });

  it("is null for every non-ok outcome, so existing callers are unchanged", async () => {
    verify.mockResolvedValue({ authUserId: "auth-1" });
    authenticate.mockRejectedValue(new Error("db down"));
    await expect(getSessionPrincipal()).resolves.toBeNull();
  });
});
