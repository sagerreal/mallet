import { describe, it, expect } from "vitest";
import { deliveryStatusOf, isTerminal, supersedes, explainSmsFailure } from "./delivery-status";

describe("deliveryStatusOf", () => {
  it("keeps 'sent' distinct from 'delivered'", () => {
    // Twilio's "sent" means the CARRIER accepted it, not that a handset got it. Collapsing the two
    // would recreate the exact confusion this whole mechanism exists to end.
    expect(deliveryStatusOf("sent")).toBe("sent");
    expect(deliveryStatusOf("delivered")).toBe("delivered");
  });

  it("treats undelivered, failed and canceled as failures", () => {
    expect(deliveryStatusOf("undelivered")).toBe("failed");
    expect(deliveryStatusOf("failed")).toBe("failed");
    expect(deliveryStatusOf("canceled")).toBe("failed");
  });

  // Guessing at a status Twilio added later could mark an undelivered message as delivered.
  it("returns null for a status it does not know", () => {
    expect(deliveryStatusOf("teleported")).toBeNull();
    expect(deliveryStatusOf("constructor")).toBeNull();
  });
});

describe("supersedes — Twilio guarantees no callback ordering", () => {
  it("lets a message move forward", () => {
    expect(supersedes("sent", "queued")).toBe(true);
    expect(supersedes("delivered", "sent")).toBe(true);
    expect(supersedes("failed", "sent")).toBe(true);
  });

  /** The bug this prevents: a late "sent" un-delivering a message that plainly arrived. */
  it("refuses to walk a message backwards", () => {
    expect(supersedes("sent", "delivered")).toBe(false);
    expect(supersedes("queued", "failed")).toBe(false);
    expect(supersedes("sent", "failed")).toBe(false);
  });

  it("refuses a repeat of the same status", () => {
    expect(supersedes("delivered", "delivered")).toBe(false);
  });

  it("knows which states are final", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("sent")).toBe(false);
  });
});

describe("explainSmsFailure", () => {
  /**
   * The one that matters here. 30034 is what a carrier returns when the sending number is not
   * registered for A2P 10DLC — the send SUCCEEDS at Twilio and the text simply never arrives, which
   * is invisible without this whole mechanism.
   */
  it("explains an unregistered number, and names the fix", () => {
    const f = explainSmsFailure("30034");
    expect(f.says).toMatch(/isn't registered for business texting/i);
    expect(f.fix).toMatch(/10DLC|toll-free/i);
  });

  it("explains a landline without pretending there is a fix for the number itself", () => {
    expect(explainSmsFailure("30006").says).toMatch(/landline/i);
  });

  it("explains an opt-out, since the shop must NOT simply retry", () => {
    const f = explainSmsFailure("21610");
    expect(f.says).toMatch(/STOP/);
    expect(f.fix).toMatch(/START/);
  });

  // Never silent: believing a text arrived when it did not is the failure mode being fixed.
  it("still explains a code it has never seen, and shows the code", () => {
    const f = explainSmsFailure("99999");
    expect(f.says).toMatch(/didn't deliver/i);
    expect(f.fix).toMatch(/99999/);
  });

  it("handles a failure that carried no code", () => {
    expect(explainSmsFailure(null).code).toBe("unknown");
  });

  // Codes arrive as free text from a provider; an inherited property must not resolve to a function.
  it("does not mistake a prototype key for an explanation", () => {
    expect(explainSmsFailure("toString").says).toMatch(/didn't deliver/i);
  });
});
