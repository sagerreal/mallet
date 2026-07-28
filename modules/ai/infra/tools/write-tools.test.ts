import { describe, it, expect } from "vitest";
import { customerCreateInput } from "./shared";

// The agent created a customer over SMS and then told the staffer "there's no address field on the
// customer record". That was false — leads.address exists, and EnsureCustomerUseCase has always
// accepted phone, email, notes and address. The TOOL hardcoded all four to null, so a customer
// created through the assistant had no way to be phoned, emailed, or driven to.
describe("customerCreateInput", () => {
  it("accepts the contact details a service business cannot work without", () => {
    const parsed = customerCreateInput.safeParse({
      name: "Sean Duggan",
      phone: "(781) 385-0591",
      email: "sean@example.com",
      address: "286 Pine St, Weymouth MA",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      phone: "(781) 385-0591",
      email: "sean@example.com",
      address: "286 Pine St, Weymouth MA",
    });
  });

  it("still accepts a bare name — the details are optional, not required", () => {
    expect(customerCreateInput.safeParse({ name: "Sean Duggan" }).success).toBe(true);
  });

  it("takes a phone in whatever shape a person dictates it", () => {
    // The handler normalises through Phone.parse before it reaches the repository, because
    // leads_org_phone_uidx is keyed on E.164 — an unparsed string would create a duplicate
    // customer instead of matching the existing one.
    for (const raw of ["(781) 385-0591", "781-385-0591", "+17813850591", "7813850591"]) {
      expect(customerCreateInput.safeParse({ name: "X", phone: raw }).success, raw).toBe(true);
    }
  });

  it("still requires a name", () => {
    expect(customerCreateInput.safeParse({ phone: "7813850591" }).success).toBe(false);
    expect(customerCreateInput.safeParse({ name: "" }).success).toBe(false);
  });
});
