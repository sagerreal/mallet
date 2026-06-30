import { describe, it, expect } from "vitest";
import { asLeadId, asOrgId, zeroMoney, money, Phone, isOk } from "@mallet/shared/types";
import { Lead, type LeadProps } from "./lead";

const baseProps = (overrides: Partial<LeadProps> = {}): LeadProps => ({
  id: asLeadId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  name: "Karen Doyle",
  phone: null,
  email: null,
  source: "web",
  stage: "new",
  value: zeroMoney,
  unread: true,
  wonAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Lead.create>): Lead => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Lead.create", () => {
  it("rejects an empty name", () => {
    const r = Lead.create(baseProps({ name: "   " }));
    expect(r.ok).toBe(false);
  });

  it("rejects a negative value", () => {
    const r = Lead.create(baseProps({ value: money(-100) }));
    expect(r.ok).toBe(false);
  });

  it("trims the name", () => {
    const lead = unwrap(Lead.create(baseProps({ name: "  Karen Doyle  " })));
    expect(lead.props.name).toBe("Karen Doyle");
  });

  it("keeps a parsed E.164 phone", () => {
    const phone = Phone.parse("(555) 123-4567");
    expect(phone.ok).toBe(true);
    if (phone.ok) {
      const lead = unwrap(Lead.create(baseProps({ phone: phone.value })));
      expect(lead.props.phone).toBe("+15551234567");
    }
  });
});

describe("Lead.moveStage", () => {
  it("stamps wonAt the first time it moves to won", () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const lead = unwrap(Lead.create(baseProps({ stage: "contacted" }))).moveStage("won", now);
    expect(lead.props.stage).toBe("won");
    expect(lead.props.wonAt?.toISOString()).toBe(now.toISOString());
  });

  it("is a no-op when already won (keeps original wonAt)", () => {
    const wonAt = new Date("2026-06-05T00:00:00Z");
    const lead = unwrap(Lead.create(baseProps({ stage: "won", wonAt })));
    const again = lead.moveStage("won", new Date("2026-06-20T00:00:00Z"));
    expect(again.props.wonAt?.toISOString()).toBe(wonAt.toISOString());
    expect(again).toBe(lead);
  });
});

describe("Lead.firstTouch", () => {
  it("moves New to Contacted on first outbound", () => {
    const lead = unwrap(Lead.create(baseProps({ stage: "new" }))).firstTouch(
      new Date("2026-06-02T00:00:00Z"),
    );
    expect(lead.props.stage).toBe("contacted");
  });

  it("does nothing once past New", () => {
    const lead = unwrap(Lead.create(baseProps({ stage: "quote_sent" })));
    const touched = lead.firstTouch(new Date("2026-06-02T00:00:00Z"));
    expect(touched).toBe(lead);
  });
});
