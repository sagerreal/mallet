import { describe, expect, it } from "vitest";
import { pickSmsIdentity, type SmsIdentityCandidate } from "./sms-identity";

/**
 * modules/notifications/infra/sms-identity.gate.test.ts
 * THE GATE'S QUESTION CHANGED, and this is what it changed to.
 *
 * Every automated path used to ask `isSmsA2pActive` — is THIS SHOP's own 10DLC campaign live —
 * and refuse before the sender was built. That made the shared line unreachable: the whole reason
 * it exists is so a shop waiting on carrier vetting can still send an invoice reminder, and the
 * gate was refusing exactly those shops. The right question for a one-way notification is "is
 * there a REGISTERED LINE to send from", which is what pickSmsIdentity answers.
 *
 * These are the four states that decide it, written as the gate sees them.
 */

const SHOP_LINE: SmsIdentityCandidate = { fromNumber: "+16693413343", messagingServiceSid: "MG-shop" };
const SHARED_LINE: SmsIdentityCandidate = { fromNumber: "+19788451336", messagingServiceSid: "MG-mallet" };
const NOTHING: SmsIdentityCandidate = { fromNumber: null, messagingServiceSid: null };

/** What the six automated call sites now compute. */
const canSend = (org: SmsIdentityCandidate, shared: SmsIdentityCandidate) =>
  pickSmsIdentity(org, shared) !== null;

describe("the automated-send gate", () => {
  /**
   * THE CASE THAT WAS BROKEN. A brand-new shop — no number, no campaign, vetting not even started
   * — must still be able to send an invoice reminder. Before this, it was refused outright.
   */
  it("lets a shop with NO registration of its own send, on the shared line", () => {
    expect(canSend(NOTHING, SHARED_LINE)).toBe(true);
    expect(pickSmsIdentity(NOTHING, SHARED_LINE)?.source).toBe("shared");
  });

  it("uses the shop's OWN line once it is registered, not the shared one", () => {
    expect(pickSmsIdentity(SHOP_LINE, SHARED_LINE)?.fromNumber).toBe(SHOP_LINE.fromNumber);
  });

  /**
   * The only honest refusal left: no line anywhere. That is a platform configuration gap
   * (MALLET_SHARED_SMS_* unset), not a task the shop can do anything about — which is why the
   * message no longer tells them to go and finish a registration.
   */
  it("refuses only when there is no line at all", () => {
    expect(canSend(NOTHING, NOTHING)).toBe(false);
  });

  it("still refuses a shop whose own number has no Messaging Service and no shared line behind it", () => {
    // A bare `from` is filtered as unregistered traffic; sending it would look like success and
    // be silently dropped by the carrier — the exact failure mode that predates A2P here.
    const halfway: SmsIdentityCandidate = { fromNumber: "+16693413343", messagingServiceSid: null };
    expect(canSend(halfway, NOTHING)).toBe(false);
  });
});
