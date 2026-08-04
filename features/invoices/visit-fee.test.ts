/**
 * features/invoices/visit-fee.test.ts
 * The visit-fee sentinel exists on BOTH sides of the wire and the two must be the same string.
 *
 * The server names the invoice with it (`RaiseVisitFeeUseCase`) and finds an already-raised fee
 * with it; the client's duplicate-collection guard hides "Collect the visit fee" by matching it
 * against `invoice.title`. If they ever drift, nothing throws and no test that only exercises one
 * side notices — the button simply stops hiding after the fee is collected, and the technician is
 * invited to charge the customer a second time.
 *
 * The client keeps its own declaration rather than importing the module's: the invoicing barrel is
 * the only sanctioned import seam for that module and it pulls the router, the Drizzle
 * repositories and the config validator, none of which belong in a browser bundle. So the two
 * declarations stay two, and THIS is the thing that makes them one.
 */

import { describe, it, expect } from "vitest";
import { VISIT_FEE_TITLE as CLIENT_TITLE } from "./visit-fee";
// Direct file import, deliberately not the barrel (see above, and CLAUDE.md's barrel gotcha).
import { VISIT_FEE_TITLE as SERVER_TITLE } from "@/modules/invoicing/app/raise-visit-fee";

describe("VISIT_FEE_TITLE", () => {
  it("is byte-identical on the client and in the invoicing module", () => {
    expect(CLIENT_TITLE).toBe(SERVER_TITLE);
  });

  // Pinned literally as well: a rename on BOTH sides in one commit still orphans every fee
  // invoice already in the shop's ledger, whose stored title keeps the old string forever.
  it("is the string already written on live invoices — renaming it orphans them", () => {
    expect(CLIENT_TITLE).toBe("Visit fee — service call");
  });
});
