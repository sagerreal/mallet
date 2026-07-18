// @vitest-environment jsdom
/**
 * features/auth/hooks.test.ts
 * Unit tests for the auth hooks' name-capturing behavior.
 *
 * The Supabase browser client is module-mocked so no network or session is
 * needed. We assert that the person's display name is threaded into
 * user_metadata (signUp) / updated on the auth user (completeInvite) so the
 * provisioning RPC can persist it to users.name.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// A brand-new signup: Supabase returns a user whose `identities` is populated.
const mockSignUp = vi.fn().mockResolvedValue({ data: { user: { identities: [{ id: "i1" }] } }, error: null });
const mockUpdateUser = vi.fn().mockResolvedValue({ error: null });
const mockRefreshSession = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: () => ({
    auth: {
      signUp: (...a: unknown[]) => mockSignUp(...a),
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      refreshSession: (...a: unknown[]) => mockRefreshSession(...a),
    },
  }),
}));

import { signUp, completeInvite } from "./hooks";

describe("signUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("threads the org name AND the person's name into user_metadata, returning 'sent'", async () => {
    const outcome = await signUp("owner@example.com", "hunter2xx", "Rivera Plumbing", "Owen Duggan");
    expect(outcome).toEqual({ kind: "sent" });
    const arg = mockSignUp.mock.calls[0]![0] as {
      email: string;
      password: string;
      options: { data: { org_name: string; name?: string } };
    };
    expect(arg.email).toBe("owner@example.com");
    expect(arg.options.data.org_name).toBe("Rivera Plumbing");
    expect(arg.options.data.name).toBe("Owen Duggan");
  });

  it("trims the name and omits it from metadata when blank", async () => {
    await signUp("owner@example.com", "hunter2xx", "Rivera Plumbing", "   ");
    const arg = mockSignUp.mock.calls[0]![0] as { options: { data: { name?: string } } };
    expect(arg.options.data.name).toBeUndefined();
  });

  it("returns the provider error message on failure", async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: null }, error: { message: "Password is too weak" } });
    const outcome = await signUp("dupe@example.com", "hunter2xx", "Org", "Name");
    expect(outcome).toEqual({ kind: "error", message: "Password is too weak" });
  });

  it("reports 'exists' when Supabase returns an obfuscated user with empty identities (no email sent)", async () => {
    // Anti-enumeration: signing up an already-registered address returns HTTP 200 with a
    // fake user whose identities array is empty, and NO confirmation email is sent. The
    // hook must surface this so the UI does not falsely claim a link was sent.
    mockSignUp.mockResolvedValueOnce({ data: { user: { identities: [] } }, error: null });
    const outcome = await signUp("already@example.com", "hunter2xx", "Org", "Name");
    expect(outcome).toEqual({ kind: "exists" });
  });
});

describe("completeInvite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets the password + name on the auth user, then refreshes the session", async () => {
    const failure = await completeInvite("hunter2xx", "Mike Rivera");
    expect(failure).toBeNull();
    const arg = mockUpdateUser.mock.calls[0]![0] as { password: string; data?: { name?: string } };
    expect(arg.password).toBe("hunter2xx");
    expect(arg.data?.name).toBe("Mike Rivera");
    // refreshSession must run AFTER updateUser so the next JWT carries the new
    // user_metadata.name for provisioning at /welcome.
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("does not refresh (and surfaces the error) when the password update fails", async () => {
    mockUpdateUser.mockResolvedValueOnce({ error: { message: "Password too short" } });
    const failure = await completeInvite("short", "Mike Rivera");
    expect(failure).toBe("Password too short");
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });
});
