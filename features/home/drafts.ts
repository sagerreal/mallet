/**
 * features/home/drafts.ts
 * Handwritten draft bank for the Needs-your-OK queue. Deterministic functions of
 * the record — no generation at render, so a draft can never misstate a fact it
 * wasn't given. Plain words a plumber would actually text.
 */

import { fmt$ } from "@/lib/format";
import { estTotal, invDue } from "@/lib/estimates";
import { firstName } from "./derive";
import type { OkItem } from "./derive";

/** The prepared outbound message for a queue card. */
export function draftFor(item: OkItem): string {
  const first = firstName(item.lead.name);

  switch (item.kind) {
    case "quote-viewed": {
      const e = item.estimate;
      const total = e ? fmt$(estTotal(e)) : "";
      return `Hi ${first} — Mike here from Rivera Plumbing. Saw you had a look at the quote${
        total ? ` (${total})` : ""
      }. Happy to walk you through it or tweak anything — want me to give you a quick call?`;
    }
    case "invoice-overdue": {
      const i = item.invoice;
      const due = i ? fmt$(invDue(i)) : "";
      return `Hi ${first} — Mike from Rivera Plumbing. Just a nudge that invoice ${
        i?.num ?? ""
      } (${due}) is still open. You can pay right from the link we texted — say the word if anything looks off.`;
    }
    case "reply":
      return `Got it, ${first} — thanks for sending that through. I'll take a look and get back to you within the hour.`;
    case "new-lead":
      return `Hi ${first} — Mike from Rivera Plumbing. Got your note about the ${item.lead.job
        .toLowerCase()
        .replace(/[.!]+$/, "")}. I can swing by and take a look — what's a good time today or tomorrow?`;
  }
}

/** A softer variant for the invoice reminder ("Soften it"). */
export function softDraftFor(item: OkItem): string {
  const first = firstName(item.lead.name);
  if (item.kind !== "invoice-overdue") return draftFor(item);
  const i = item.invoice;
  return `Hi ${first} — Mike from Rivera Plumbing. No rush at all, just keeping invoice ${
    i?.num ?? ""
  } on your radar. The pay link's in the earlier text whenever suits.`;
}
