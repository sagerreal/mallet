// @vitest-environment jsdom
/**
 * features/auth/hooks.test.ts
 * Unit tests for the auth hooks' name-capturing behavior.
 *
 * The Supabase browser client is module-mocked so no network or session is
 * needed. We assert that the person's display name is updated on the auth user
 * (completeInvite) so the provisioning RPC can persist it to users.name.
 * (signUp is gone with the /signup form — Mallet is invite-only.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdateUser = vi.fn().mockResolvedValue({ error: null });
const mockRefreshSession = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: () => ({
    auth: {
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      refreshSession: (...a: unknown[]) => mockRefreshSession(...a),
    },
  }),
}));

import { completeInvite } from "./hooks";

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
