import { describe, it, expect } from "vitest";
import type { BusinessIdentity } from "@/lib/store/types";
import { documentContact, documentIdentity } from "./document-business";

const identity = (over: Partial<BusinessIdentity> = {}): BusinessIdentity => ({
  name: "Ridgeline Plumbing",
  address: "200 Ray St, Pleasanton, CA 94566",
  phone: "(925) 555-0100",
  email: "billing@ridgeline.test",
  site: "ridgelineplumbing.com",
  license: "C36-1029384",
  ...over,
});

describe("documentContact — for a surface under a branded header", () => {
  it("cannot carry the shop's name, by shape", () => {
    const contact = documentContact(identity());
    expect(Object.keys(contact ?? {}).sort()).toEqual([
      "address",
      "email",
      "license",
      "phone",
      "site",
    ]);
  });

  it("passes each contact field straight through", () => {
    expect(documentContact(identity())).toEqual({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      site: "ridgelineplumbing.com",
      license: "C36-1029384",
    });
  });

  it("keeps an unset field null rather than blank — a blank prints an empty label", () => {
    expect(documentContact(identity({ license: null, site: null }))).toMatchObject({
      license: null,
      site: null,
    });
  });

  it("is undefined before the hydrator lands, so the block is omitted entirely", () => {
    // Not an empty object: an empty object still renders a (blank) block.
    expect(documentContact(null)).toBeUndefined();
    expect(documentContact(undefined)).toBeUndefined();
  });
});

describe("documentIdentity — for a surface with no branded chrome of its own", () => {
  it("adds the shop's name to the same contact block", () => {
    expect(documentIdentity(identity())).toEqual({
      name: "Ridgeline Plumbing",
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@ridgeline.test",
      site: "ridgelineplumbing.com",
      license: "C36-1029384",
    });
  });

  it("is undefined before the hydrator lands — never the brand placeholder", () => {
    // store.brand falls back to "My Business"; printing that on a customer's bill is a lie, so
    // this returns nothing at all until the real identity has arrived.
    expect(documentIdentity(null)).toBeUndefined();
  });

  it("still names the shop when every other field is unset", () => {
    const bare = identity({ address: null, phone: null, email: null, site: null, license: null });
    expect(documentIdentity(bare)).toEqual({
      name: "Ridgeline Plumbing",
      address: null,
      phone: null,
      email: null,
      site: null,
      license: null,
    });
  });
});
