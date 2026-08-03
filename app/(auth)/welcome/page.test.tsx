// @vitest-environment jsdom
// app/(auth)/welcome/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The one screen between signing in and having a workspace.
 *
 * It asks three things now. The ZIP does double duty — the phone number's area code AND the
 * timezone, which is otherwise America/Los_Angeles forever with no UI to correct it. The mobile is
 * users.callback_number: click-to-call has no other way to learn it, and 1 user out of 81 has one.
 */

const provisionMutate = vi.fn();
const setCallback = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/identity/hooks", () => ({
  useEnsureProvisioned: () => ({ mutate: provisionMutate, isPending: false, isError: false, error: null }),
}));
// `mutate` is wrapped in a closure (not a direct reference) so this factory can be evaluated
// during module instantiation — which happens before this file's own `const setCallback =
// vi.fn()` runs — without hitting the TDZ. The closure only reads `setCallback` once it is
// actually called, by which point the assignment above has long since happened.
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { calls: { setCallbackNumber: { mutate: (...args: unknown[]) => setCallback(...args) } } } },
}));

import WelcomePage from "./page";

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the welcome screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provisionMutate.mockImplementation((_input, opts) => opts?.onSuccess?.({ role: "owner" }));
    setCallback.mockResolvedValue({ callbackNumber: "+16175550142" });
  });

  it("sends the timezone derived from the ZIP", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(provisionMutate.mock.calls[0]![0]).toMatchObject({
      orgName: "Summit Plumbing",
      postalCode: "02189",
      timezone: "America/New_York",
    });
  });

  it("stores the mobile so click-to-call has a number to ring", async () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(setCallback).toHaveBeenCalledWith({ callbackNumber: "(617) 555-0142" });
  });

  // The ZIP is the only source of the timezone; an unrecognised one must not invent a zone.
  it("omits the timezone when the ZIP is outside the table", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "00500");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(provisionMutate.mock.calls[0]![0].timezone).toBeUndefined();
  });

  it("says which timezone it picked — a silent guess is the bug being fixed", () => {
    render(<WelcomePage />);
    fill("ZIP code", "02189");
    expect(screen.getByText(/Eastern/i)).toBeTruthy();
  });

  it("will not submit without all three answers", () => {
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    expect(screen.getByRole("button", { name: /create workspace/i })).toHaveProperty("disabled", true);
  });

  // Provisioning is the write that matters; a failed callback save must not strand the shop
  // outside its own workspace. Awaiting the rejected promise itself (rather than just
  // `Promise.resolve()`, which resolves before router.replace is even reached) is what actually
  // pins "still enters the workspace" — without it this test passed even with the whole
  // `.catch()` deleted, because router.replace runs synchronously either way.
  it("still enters the workspace when saving the mobile fails", async () => {
    const rejection = new Error("offline");
    setCallback.mockRejectedValue(rejection);
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await expect(setCallback.mock.results[0]!.value).rejects.toThrow("offline");
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  // Losing the number silently is the exact bug this field exists to fix (1 of 81 users had one
  // set) — a failed fire-and-forget save must leave a trace even though it must not block entry.
  it("logs (but does not throw) when saving the mobile fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setCallback.mockRejectedValue(new Error("offline"));
    render(<WelcomePage />);
    fill("Business name", "Summit Plumbing");
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await expect(setCallback.mock.results[0]!.value).rejects.toThrow("offline");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("setCallbackNumber failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
