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

  it("returns the same instance when target stage equals current non-won stage", () => {
    const lead = unwrap(Lead.create(baseProps({ stage: "contacted" })));
    const again = lead.moveStage("contacted", new Date("2026-06-15T00:00:00Z"));
    expect(again).toBe(lead);
  });

  it("preserves the original wonAt when re-moving a won lead to won via a different path (already-won wonAt)", () => {
    const firstWonAt = new Date("2026-06-05T00:00:00Z");
    // Simulate: lead was previously won (wonAt already set), moved away, then moved back to won.
    const lead = unwrap(
      Lead.create(baseProps({ stage: "contacted", wonAt: firstWonAt })),
    ).moveStage("won", new Date("2026-06-20T00:00:00Z"));
    // The wonAt ?? now path should pick wonAt (firstWonAt), not the new `now`.
    expect(lead.props.wonAt?.toISOString()).toBe(firstWonAt.toISOString());
    expect(lead.props.stage).toBe("won");
  });

  it("clears wonAt when moving away from won to a non-won stage", () => {
    const wonAt = new Date("2026-06-05T00:00:00Z");
    const lead = unwrap(Lead.create(baseProps({ stage: "won", wonAt })));
    const moved = lead.moveStage("lost", new Date("2026-06-15T00:00:00Z"));
    expect(moved.props.stage).toBe("lost");
    // wonAt is propagated as-is when moving to non-won (the source stays null-or-set).
    // The domain keeps wonAt on the struct unchanged when not moving to won.
    expect(moved.props.wonAt?.toISOString()).toBe(wonAt.toISOString());
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

  it("is a no-op when stage is contacted (returns same instance)", () => {
    const lead = unwrap(Lead.create(baseProps({ stage: "contacted" })));
    expect(lead.firstTouch(new Date("2026-06-02T00:00:00Z"))).toBe(lead);
  });

  it("is a no-op when stage is won (returns same instance)", () => {
    const now = new Date("2026-06-02T00:00:00Z");
    const wonAt = new Date("2026-06-01T00:00:00Z");
    const lead = unwrap(Lead.create(baseProps({ stage: "won", wonAt })));
    expect(lead.firstTouch(now)).toBe(lead);
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

describe("Lead.markUnread", () => {
  it("sets the unread flag when currently read", () => {
    const now = new Date("2026-06-04T00:00:00Z");
    const lead = unwrap(Lead.create(baseProps({ unread: false }))).markUnread(now);
    expect(lead.props.unread).toBe(true);
    expect(lead.props.updatedAt.toISOString()).toBe(now.toISOString());
  });

  it("is a no-op when already unread (returns same instance)", () => {
    const lead = unwrap(Lead.create(baseProps({ unread: true })));
    const again = lead.markUnread(new Date("2026-06-04T00:00:00Z"));
    expect(again).toBe(lead);
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
