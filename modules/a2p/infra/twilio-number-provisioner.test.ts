import { describe, it, expect, vi } from "vitest";
import { TwilioNumberProvisioner, type NumberPurchaseTransport } from "./twilio-number-provisioner";
import { isOk } from "@mallet/shared/types";

const SMS_URL = "https://app.trymallet.com/api/webhooks/twilio";

function makeTransport(over: Partial<NumberPurchaseTransport> = {}): NumberPurchaseTransport {
  return {
    search: vi.fn(async () => [{ phoneNumber: "+17815550123" }]),
    buy: vi.fn(async ({ phoneNumber }) => ({ sid: "PN_test", phoneNumber })),
    ...over,
  };
}

const make = (t: NumberPurchaseTransport) => new TwilioNumberProvisioner("AC_test", "token", SMS_URL, t);

describe("TwilioNumberProvisioner", () => {
  it("buys a number local to the shop's ZIP", async () => {
    const t = makeTransport();
    const r = await make(t).provision({ postalCode: "02189" });

    expect(isOk(r)).toBe(true);
    expect(t.search).toHaveBeenCalledWith({ postalCode: "02189" });
    if (isOk(r)) expect(r.value.phoneNumber).toBe("+17815550123");
  });

  it("captures the PN sid, which cannot be derived from the number later", async () => {
    // A2pGateway.attachNumber takes a phoneNumberSid; nothing can turn "+1781…" back into "PN…"
    // without another API round-trip, so it has to be captured at purchase.
    const r = await make(makeTransport()).provision({ postalCode: "02189" });
    if (isOk(r)) expect(r.value.phoneNumberSid).toBe("PN_test");
  });

  it("points the new number's SMS webhook at Elas", async () => {
    const t = makeTransport();
    await make(t).provision({ postalCode: "02189" });
    expect(t.buy).toHaveBeenCalledWith(expect.objectContaining({ smsUrl: SMS_URL }));
  });

  it("widens to the STATE when the ZIP is sold out", async () => {
    const search = vi
      .fn<NumberPurchaseTransport["search"]>()
      .mockResolvedValueOnce([]) // nothing in 02189
      .mockResolvedValueOnce([{ phoneNumber: "+16175550100" }]); // something in MA
    const t = makeTransport({ search });

    const r = await make(t).provision({ postalCode: "02189" });

    expect(isOk(r)).toBe(true);
    expect(search).toHaveBeenNthCalledWith(2, { region: "MA" });
  });

  it("widens to ANYWHERE when the state is sold out too", async () => {
    // A shop with a number in the next area code is mildly disappointed. A shop with no number
    // cannot be called at all — so this must never end in failure while numbers exist.
    const search = vi
      .fn<NumberPurchaseTransport["search"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ phoneNumber: "+12125550111" }]);
    const t = makeTransport({ search });

    const r = await make(t).provision({ postalCode: "02189" });

    expect(isOk(r)).toBe(true);
    expect(search).toHaveBeenNthCalledWith(3, {});
    if (isOk(r)) expect(r.value.phoneNumber).toBe("+12125550111");
  });

  it("searches nationally straight away when there is no ZIP", async () => {
    const t = makeTransport();
    await make(t).provision({ postalCode: null });
    expect(t.search).toHaveBeenCalledWith({});
    expect(t.search).toHaveBeenCalledTimes(1);
  });

  it("returns an error rather than throwing when Twilio is down", async () => {
    // Signup calls this. An exception escaping here would fail the whole signup over a phone
    // number, which is the one thing that must not happen.
    const t = makeTransport({ search: vi.fn(async () => { throw new Error("ETIMEDOUT"); }) });
    const r = await make(t).provision({ postalCode: "02189" });
    expect(isOk(r)).toBe(false);
  });

  it("returns an error when the whole country is genuinely empty", async () => {
    const t = makeTransport({ search: vi.fn(async () => []) });
    const r = await make(t).provision({ postalCode: "02189" });

    expect(isOk(r)).toBe(false);
    expect(t.buy).not.toHaveBeenCalled();
  });
});
