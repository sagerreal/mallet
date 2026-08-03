// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The one screen between signing in and having a workspace.
 *
 * It asks THREE things, and the business name is not one of them — that was typed at signup, and
 * being made to type it twice is the first thing a shop notices. The three:
 *
 *  - TRADE, which decides the front desk's starter services. Without it every org got the plumbing
 *    playbook, so a roofer's AI receptionist offered water heater repair at our invented prices.
 *  - ZIP, which picks the phone number's area code AND the timezone (otherwise
 *    America/Los_Angeles forever, which the front desk reads when it offers appointment times).
 *  - MOBILE, which fills users.callback_number — click-to-call has no other way to learn it, and
 *    1 user out of 81 had one set.
 *
 * The mocks wrap their spies in closures rather than referencing them directly: a vi.mock factory
 * is evaluated during module instantiation, before this file's own consts run, so a bare reference
 * hits the TDZ.
 */

const { provisionMutate, setCallback, replace, getSession } = vi.hoisted(() => ({
  provisionMutate: vi.fn(),
  setCallback: vi.fn(),
  replace: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/features/identity/hooks", () => ({
  useEnsureProvisioned: () => ({ mutate: provisionMutate, isPending: false, isError: false, error: null }),
}));
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { calls: { setCallbackNumber: { mutate: (...a: unknown[]) => setCallback(...a) } } } },
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: () => ({ auth: { getSession: (...a: unknown[]) => getSession(...a) } }),
}));
// The real hook gates submit until React attaches, so a submit can never be a native GET. Always
// hydrated here — the un-hydrated case belongs to use-hydrated's own tests.
vi.mock("@/lib/use-hydrated", () => ({ useHydrated: () => true }));

import WelcomePage from "./page";

const session = (orgName?: string) => ({
  data: { session: orgName ? { user: { user_metadata: { org_name: orgName } } } : null },
});

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Every answer the form needs, so a test can vary exactly one thing. */
const answerEverything = () => {
  fill("Trade", "roofing");
  fill("ZIP code", "02189");
  fill("Your mobile", "(617) 555-0142");
};

const clickCreate = () => fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

/** The prefill lands asynchronously; nothing may be asserted until it has. */
const rendered = async () => {
  render(<WelcomePage />);
  await waitFor(() => expect(getSession).toHaveBeenCalled());
};

describe("the welcome screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(session("Something Roofing"));
    provisionMutate.mockImplementation((_input, opts) => opts?.onSuccess?.({ role: "owner" }));
    setCallback.mockResolvedValue({ callbackNumber: "+16175550142" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefills the business name from signup rather than asking for it again", async () => {
    await rendered();
    await waitFor(() =>
      expect(screen.getByLabelText("Business name")).toHaveProperty("value", "Something Roofing"),
    );
  });

  // A typo made at signup has nowhere else to be fixed before the org exists.
  it("still lets the name be corrected", async () => {
    await rendered();
    await waitFor(() =>
      expect(screen.getByLabelText("Business name")).toHaveProperty("value", "Something Roofing"),
    );
    fill("Business name", "Something Roofing LLC");
    answerEverything();
    clickCreate();
    expect(provisionMutate.mock.calls[0]![0].orgName).toBe("Something Roofing LLC");
  });

  it("sends the trade, so the front desk gets the right starter services", async () => {
    await rendered();
    answerEverything();
    clickCreate();
    expect(provisionMutate.mock.calls[0]![0].trade).toBe("roofing");
  });

  it("offers every trade as a choice, so nobody has to type one", async () => {
    await rendered();
    const options = Array.from(screen.getByLabelText("Trade").querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toContain("hvac");
    expect(options).toContain("roofing");
    expect(options).toContain("painting");
    expect(options).toContain("other");
  });

  it("sends the timezone derived from the ZIP", async () => {
    await rendered();
    answerEverything();
    clickCreate();
    expect(provisionMutate.mock.calls[0]![0]).toMatchObject({
      postalCode: "02189",
      timezone: "America/New_York",
    });
  });

  // The ZIP is the only source of the timezone; an unrecognised one must not invent a zone.
  it("omits the timezone when the ZIP is outside the table", async () => {
    await rendered();
    fill("Trade", "roofing");
    fill("ZIP code", "00500");
    fill("Your mobile", "(617) 555-0142");
    clickCreate();
    expect(provisionMutate.mock.calls[0]![0].timezone).toBeUndefined();
  });

  it("says which timezone it picked — a silent guess is the bug being fixed", async () => {
    await rendered();
    fill("ZIP code", "02189");
    expect(screen.getByText(/Eastern/i)).toBeTruthy();
  });

  it("stores the mobile so click-to-call has a number to ring", async () => {
    await rendered();
    answerEverything();
    clickCreate();
    expect(setCallback).toHaveBeenCalledWith({ callbackNumber: "(617) 555-0142" });
  });

  it("will not submit until every question is answered", async () => {
    await rendered();
    fill("ZIP code", "02189");
    fill("Your mobile", "(617) 555-0142");
    // Trade deliberately left unanswered.
    expect(screen.getByRole("button", { name: /create workspace/i })).toHaveProperty("disabled", true);
  });

  /**
   * THE FLASH Owen reported. `provision.isPending` goes false the instant the mutation resolves,
   * and the navigation that follows takes another beat — so the button reverted to "Create
   * workspace" and sat there looking un-pressed. It read as a failed click, and worse on mobile
   * where navigation is slower.
   */
  it("stays in its pending state through the navigation, not just to the response", async () => {
    await rendered();
    answerEverything();
    clickCreate();
    expect(screen.getByRole("button", { name: /setting up/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create workspace/i })).toBeNull();
  });

  it("enters the workspace", async () => {
    await rendered();
    answerEverything();
    clickCreate();
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("sends a technician to their day, not the office dashboard", async () => {
    provisionMutate.mockImplementation((_input, opts) => opts?.onSuccess?.({ role: "tech" }));
    await rendered();
    answerEverything();
    clickCreate();
    expect(replace).toHaveBeenCalledWith("/my-day");
  });

  // Provisioning is the write that matters; a failed callback save must not strand the shop
  // outside the workspace it just created.
  it("still enters the workspace when saving the mobile fails", async () => {
    setCallback.mockRejectedValue(new Error("offline"));
    await rendered();
    answerEverything();
    clickCreate();
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  // …but it must not vanish silently, which is the bug that left 80 of 81 users without one.
  it("logs when saving the mobile fails, rather than losing it without trace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setCallback.mockRejectedValue(new Error("offline"));
    await rendered();
    answerEverything();
    clickCreate();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("setCallbackNumber"), expect.anything()),
    );
  });

  // An invited joiner's session carries no org_name; the form must still be usable.
  it("renders an empty name rather than breaking when the session carries none", async () => {
    getSession.mockResolvedValue(session(undefined));
    await rendered();
    expect(screen.getByLabelText("Business name")).toHaveProperty("value", "");
  });
});
