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
  companyId: null,
  role: null,
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

describe("Lead.markRead", () => {
  it("clears the unread flag", () => {
    const lead = unwrap(Lead.create(baseProps({ unread: true }))).markRead(
      new Date("2026-06-03T00:00:00Z"),
    );
    expect(lead.props.unread).toBe(false);
  });

  it("is a no-op when already read", () => {
    const lead = unwrap(Lead.create(baseProps({ unread: false })));
    expect(lead.markRead(new Date("2026-06-03T00:00:00Z"))).toBe(lead);
  });
});

describe("Lead.patch", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("patches a provided field and bumps updatedAt", () => {
    const lead = unwrap(Lead.create(baseProps({ name: "Karen Doyle" })));
    const result = lead.patch({ name: "Karen D." }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Karen D.");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
      // other fields unchanged
      expect(result.value.props.source).toBe(lead.props.source);
    }
  });

  it("rejects an invalid patch value (empty name)", () => {
    const lead = unwrap(Lead.create(baseProps()));
    const result = lead.patch({ name: "   " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("patch with no fields returns equal props with bumped updatedAt", () => {
    const lead = unwrap(Lead.create(baseProps()));
    const result = lead.patch({}, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe(lead.props.name);
      expect(result.value.props.email).toBe(lead.props.email);
      expect(result.value.props.source).toBe(lead.props.source);
      expect(result.value.props.phone).toBe(lead.props.phone);
      expect(result.value.props.value).toBe(lead.props.value);
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("allows patching phone to null", () => {
    const phone = Phone.parse("(555) 123-4567");
    expect(phone.ok).toBe(true);
    if (!phone.ok) return;
    const lead = unwrap(Lead.create(baseProps({ phone: phone.value })));
    const result = lead.patch({ phone: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.phone).toBeNull();
    }
  });
});
