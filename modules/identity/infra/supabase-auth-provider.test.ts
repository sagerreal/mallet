import { describe, it, expect } from "vitest";
import { asUserId, asOrgId } from "@mallet/shared/types";
import type { TokenVerifier, PrincipalResolver } from "../domain/auth-provider";
import type { Principal } from "../domain/principal";
import { SupabaseAuthProvider } from "./supabase-auth-provider";

const PRINCIPAL: Principal = {
  userId: asUserId("99999999-9999-9999-9999-999999999999"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  role: "owner",
};

const verifierThatReturns = (authUserId: string | null): TokenVerifier => ({
  verify: async () => (authUserId ? { authUserId, email: "o@x.com", orgNameHint: null, name: null } : null),
});

const resolverThatReturns = (principal: Principal | null): PrincipalResolver => ({
  resolve: async () => principal,
});

describe("SupabaseAuthProvider.authenticate", () => {
  it("returns the principal for a valid token of a provisioned user", async () => {
    const provider = new SupabaseAuthProvider(
      verifierThatReturns("auth-123"),
      resolverThatReturns(PRINCIPAL),
    );
    const r = await provider.authenticate("good-token");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.orgId).toBe(PRINCIPAL.orgId);
  });

  it("rejects an empty token before any I/O", async () => {
    const provider = new SupabaseAuthProvider(
      verifierThatReturns("auth-123"),
      resolverThatReturns(PRINCIPAL),
    );
    const r = await provider.authenticate("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unauthorized");
  });

  it("rejects an invalid/expired token", async () => {
    const provider = new SupabaseAuthProvider(
      verifierThatReturns(null),
      resolverThatReturns(PRINCIPAL),
    );
    const r = await provider.authenticate("bad-token");
    expect(r.ok).toBe(false);
  });

  it("rejects a valid token whose user is not provisioned in any org", async () => {
    const provider = new SupabaseAuthProvider(
      verifierThatReturns("auth-unknown"),
      resolverThatReturns(null),
    );
    const r = await provider.authenticate("good-token");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unauthorized");
  });
});
