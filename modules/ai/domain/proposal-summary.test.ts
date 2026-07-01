import { describe, it, expect } from "vitest";
import { describeProposal } from "./proposal-summary";

describe("describeProposal", () => {
  it("summarizes quote_draft with subtotal math (optional lines excluded), tax and deposit", () => {
    const s = describeProposal("quote_draft", {
      leadId: "0b8f2c1a-1111-2222-3333-444444444444",
      title: "Panel upgrade",
      taxBps: 875,
      depBps: 2500,
      lines: [
        { description: "Labor", quantity: 2, rateCents: 15000 },
        { description: "Panel", quantity: 1, rateCents: 42000 },
        { description: "Surge protector (optional)", quantity: 1, rateCents: 9900, isOptional: true },
      ],
    });
    expect(s).toContain("0b8f2c1a-1111-2222-3333-444444444444");
    expect(s).toContain('"Panel upgrade"');
    expect(s).toContain("3 line item(s)");
    expect(s).toContain("$720.00"); // 2×150 + 1×420, optional excluded
    expect(s).toContain("tax 8.75%");
    expect(s).toContain("deposit 25%");
    expect(s).toContain("DRAFT");
  });

  it("omits absent title/tax/deposit rather than rendering empty fragments", () => {
    const s = describeProposal("quote_draft", { leadId: "x", lines: [{ description: "Labor", quantity: 1, rateCents: 5000 }] });
    expect(s).toContain("1 line item(s), subtotal $50.00");
    expect(s).not.toContain("tax");
    expect(s).not.toContain("deposit");
    expect(s).not.toContain('""');
  });

  it("summarizes invoice_send with the invoice id and the payment-terms consequence", () => {
    const s = describeProposal("invoice_send", { invoiceId: "inv-1" });
    expect(s).toContain("inv-1");
    expect(s).toContain("SENT");
    expect(s).toContain("payment terms");
  });

  it("falls back to compact JSON for a tool without a bespoke renderer", () => {
    const s = describeProposal("future_tool", { a: 1 });
    expect(s).toContain("future_tool");
    expect(s).toContain('{"a":1}');
  });
});
