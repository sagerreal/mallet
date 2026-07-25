/**
 * lib/store/slices/call-slice.test.ts
 *
 * Two regressions are locked here:
 *
 *  1. The bar used to flip to "live" the moment the provider ACCEPTED the request — before the
 *     agent's phone had even rung — so the timer counted the answer delay as talk time. Placing a
 *     call must leave the bar connecting; only an observed status makes it live.
 *  2. A failure used to render the transport error verbatim, which put a Drizzle
 *     `Failed query: select "callback_number" …` string (SQL and column names) in front of the user.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import { CALL_UNCONFIRMED } from "./call-slice";

const place = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { calls: { place: { mutate: (...args: unknown[]) => place(...args) } } } },
}));

const store = () => useAppStore.getState();
const LEAD = { id: "lead-1", name: "Dana Alvarez", phone: "(925) 555-0100" };

// A rejection shaped the way tRPC delivers one to a vanilla client.
const trpcError = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

describe("call-slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeCall: null, leads: [LEAD] as never });
    place.mockResolvedValue({ id: "call-1" });
  });

  it("refuses to open a bar for a lead with no phone", () => {
    useAppStore.setState({ leads: [{ ...LEAD, phone: "" }] as never });
    expect(store().startCall("lead-1")).toBe(false);
    expect(store().activeCall).toBeNull();
    expect(place).not.toHaveBeenCalled();
  });

  it("stays CONNECTING when the call is accepted — accepted is not answered", async () => {
    store().startCall("lead-1");
    expect(store().activeCall?.phase).toBe("connecting");
    await vi.waitFor(() => expect(store().activeCall?.callId).toBe("call-1"));
    expect(store().activeCall?.phase).toBe("connecting");
    expect(store().activeCall?.sec).toBe(0);
  });

  it("shows plain copy — never SQL — when the server throws an internal error", async () => {
    place.mockRejectedValue(
      trpcError("INTERNAL_SERVER_ERROR", 'Failed query: select "callback_number" from "users"'),
    );
    store().startCall("lead-1");
    await vi.waitFor(() => expect(store().activeCall?.phase).toBe("failed"));
    const shown = store().activeCall?.error ?? "";
    expect(shown).not.toMatch(/select|callback_number|Failed query/);
    expect(shown).toBe("the call could not be placed");
  });

  it("passes a domain refusal through — it names the fix, and the user can act on it", async () => {
    place.mockRejectedValue(
      trpcError("CONFLICT", "add the mobile number Mallet should ring you on before placing a call"),
    );
    store().startCall("lead-1");
    await vi.waitFor(() => expect(store().activeCall?.phase).toBe("failed"));
    expect(store().activeCall?.error).toMatch(/mobile number Mallet should ring you on/);
  });

  describe("applyCallStatus", () => {
    const connecting = () => {
      store().startCall("lead-1");
      useAppStore.setState({
        activeCall: { leadId: "lead-1", sec: 0, notes: "", phase: "connecting", callId: "call-1", error: null },
      });
    };

    it("goes live only when the phone is actually answered, timing from the server's start", () => {
      connecting();
      const startedAt = new Date(Date.now() - 12_000).toISOString();
      store().applyCallStatus("call-1", { status: "in_progress", startedAt, durationSec: null });
      expect(store().activeCall?.phase).toBe("live");
      // Seeded from server truth, so a late poll does not lose the seconds already spent talking.
      expect(store().activeCall?.sec).toBeGreaterThanOrEqual(11);
    });

    it("ends with the provider's duration when the call completes", () => {
      connecting();
      store().applyCallStatus("call-1", { status: "completed", startedAt: null, durationSec: 42 });
      expect(store().activeCall?.phase).toBe("ended");
      expect(store().activeCall?.sec).toBe(42);
    });

    it("says whose phone did not answer — the leg that rang is YOURS", () => {
      connecting();
      store().applyCallStatus("call-1", { status: "no_answer", startedAt: null, durationSec: null });
      expect(store().activeCall?.phase).toBe("failed");
      expect(store().activeCall?.error).toMatch(/your phone/i);
    });

    it("ignores a status for a different call", () => {
      connecting();
      store().applyCallStatus("other-call", { status: "in_progress", startedAt: null, durationSec: null });
      expect(store().activeCall?.phase).toBe("connecting");
    });

    it("cannot resurrect a call that already ended", () => {
      connecting();
      store().applyCallStatus("call-1", { status: "completed", startedAt: null, durationSec: 10 });
      store().applyCallStatus("call-1", { status: "in_progress", startedAt: null, durationSec: null });
      expect(store().activeCall?.phase).toBe("ended");
    });

    it("admits it does not know when the bar gives up waiting", () => {
      connecting();
      store().applyCallStatus("call-1", { status: CALL_UNCONFIRMED, startedAt: null, durationSec: null });
      expect(store().activeCall?.phase).toBe("failed");
      // Deliberately NOT "you didn't answer" — we never found out which it was.
      expect(store().activeCall?.error).toMatch(/never heard this call connect/i);
    });

    it("ignores an unknown provider status rather than guessing", () => {
      connecting();
      store().applyCallStatus("call-1", { status: "something-new", startedAt: null, durationSec: null });
      expect(store().activeCall?.phase).toBe("connecting");
    });
  });
});
