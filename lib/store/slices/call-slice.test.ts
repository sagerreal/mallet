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
const browserToken = vi.fn();
const connectBrowser = vi.fn();
const hangUp = vi.fn();
const mute = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: { calls: { place: { mutate: (...args: unknown[]) => place(...args) }, browserToken: { query: () => browserToken() } } },
  },
}));

// The softphone module is stubbed: these tests are about what the STORE does, and a real Device
// would need a microphone and a live provider.
vi.mock("@/lib/calls/browser-device", () => ({
  connectBrowserCall: (...args: unknown[]) => connectBrowser(...args),
  hangUpBrowserCall: () => hangUp(),
  muteBrowserCall: (m: boolean) => mute(m),
}));

const store = () => useAppStore.getState();
const LEAD = { id: "lead-1", name: "Dana Alvarez", phone: "(925) 555-0100" };

// A rejection shaped the way tRPC delivers one to a vanilla client.
const trpcError = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

describe("call-slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeCall: null, leads: [LEAD] as never });
    place.mockResolvedValue({ id: "call-1", transport: "phone" });
    browserToken.mockResolvedValue({ token: "jwt-token" });
    connectBrowser.mockResolvedValue(undefined);
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
        activeCall: { leadId: "lead-1", sec: 0, notes: "", phase: "connecting", callId: "call-1", error: null, transport: "phone", muted: false },
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

  // The browser transport: Mallet carries the call itself. The row is a reservation; the DEVICE
  // connect is what dials, so a failure there must reach the bar rather than leaving a row that
  // never rang.
  describe("browser transport", () => {
    beforeEach(() => {
      place.mockResolvedValue({ id: "call-1", transport: "browser" });
    });

    it("connects this browser to the reserved call", async () => {
      store().startCall("lead-1", "browser");
      await vi.waitFor(() => expect(connectBrowser).toHaveBeenCalledTimes(1));
      expect(place).toHaveBeenCalledWith({ leadId: "lead-1", transport: "browser" });
      expect(connectBrowser.mock.calls[0]![0]).toBe("call-1");
      expect(connectBrowser.mock.calls[0]![1]).toBe("jwt-token");
      expect(store().activeCall?.transport).toBe("browser");
      // Still connecting: the customer's phone has not been answered.
      expect(store().activeCall?.phase).toBe("connecting");
    });

    it("surfaces a device failure instead of leaving a call that never rang", async () => {
      connectBrowser.mockRejectedValue(Object.assign(new Error("NotAllowedError"), { data: { code: "INTERNAL_SERVER_ERROR" } }));
      store().startCall("lead-1", "browser");
      await vi.waitFor(() => expect(store().activeCall?.phase).toBe("failed"));
      expect(store().activeCall?.error).toBe("this browser could not carry the call");
    });

    it("mute is a real mute, and only on a call this browser is carrying", () => {
      store().startCall("lead-1", "browser");
      store().toggleCallMute();
      expect(mute).toHaveBeenCalledWith(true);
      expect(store().activeCall?.muted).toBe(true);
      store().toggleCallMute();
      expect(mute).toHaveBeenLastCalledWith(false);
    });

    it("does not pretend to mute a bridged call — the handset owns that", () => {
      place.mockResolvedValue({ id: "call-1", transport: "phone" });
      store().startCall("lead-1");
      store().toggleCallMute();
      expect(mute).not.toHaveBeenCalled();
      expect(store().activeCall?.muted).toBe(false);
    });

    it("ending or dismissing hangs up the line, never just the label", () => {
      store().startCall("lead-1", "browser");
      store().markCallEnded();
      expect(hangUp).toHaveBeenCalled();
      hangUp.mockClear();
      store().clearCall();
      expect(hangUp).toHaveBeenCalled();
    });
  });
});
