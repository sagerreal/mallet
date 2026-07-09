/**
 * features/home/drafts.ts
 * Handwritten draft bank for the Needs-your-OK queue. Deterministic functions of
 * the record — no generation at render, so a draft can never misstate a fact it
 * wasn't given. Plain words a plumber would actually text.
 *
 * orgName and ownerFirst are real org data threaded from the caller (dashboard
 * page → OkQueue → OkCard → draftFor). Both have safe fallbacks so callers that
 * cannot yet supply them still produce coherent copy.
 */

import { fmt$ } from "@/lib/format";
import { estTotal, invDue } from "@/lib/estimates";
import { firstName } from "./derive";
import type { OkItem } from "./derive";

export interface DraftContext {
  /** The org's display name (e.g. "Rivera Plumbing"). Defaults to "us". */
  orgName?: string;
  /** The owner's first name (e.g. "Mike"). Defaults to empty string (omitted). */
  ownerFirst?: string;
}

/** Returns the "Name from OrgName" sender fragment, or just "Name" if no org. */
function sender(ctx: DraftContext): string {
  const name = ctx.ownerFirst?.trim() ?? "";
  const org = ctx.orgName?.trim() ?? "";
  if (name && org) return `${name} from ${org}`;
  if (name) return name;
  if (org) return org;
  return "us";
}

/** The prepared outbound message for a queue card. */
export function draftFor(item: OkItem, ctx: DraftContext = {}): string {
  const first = firstName(item.lead.name);
  const from = sender(ctx);

  switch (item.kind) {
    case "quote-viewed": {
      const e = item.estimate;
      const total = e ? fmt$(estTotal(e)) : "";
      // Two handwritten variants keyed by the quote id's last character, so two
      // adjacent cards never read as mail-merge.
      const lastChar = (e?.id ?? "").slice(-1);
      if (lastChar <= "m") {
        return `Hi ${first} — ${from} here. Saw you had a look at the quote${
          total ? ` (${total})` : ""
        }. Happy to walk you through it or tweak anything — want me to give you a quick call?`;
      }
      return `Hi ${first} — ${from}. That quote${
        total ? ` (${total})` : ""
      } is good whenever you are — want me to pencil you in this week, or is there anything you'd change first?`;
    }
    case "invoice-overdue": {
      const i = item.invoice;
      const due = i ? fmt$(invDue(i)) : "";
      return `Hi ${first} — ${from}. Just a nudge that invoice ${
        i?.num ?? ""
      } (${due}) is still open. You can pay right from the link we texted — say the word if anything looks off.`;
    }
    case "reply":
      return `Got it, ${first} — thanks for sending that through. I'll take a look and get back to you within the hour.`;
    case "new-lead":
      return `Hi ${first} — ${from}. Got your note about the ${item.lead.job
        .toLowerCase()
        .replace(/[.!]+$/, "")}. I can swing by and take a look — what's a good time today or tomorrow?`;
  }
}

/** A softer variant for the invoice reminder ("Soften it"). */
export function softDraftFor(item: OkItem, ctx: DraftContext = {}): string {
  const first = firstName(item.lead.name);
  const from = sender(ctx);
  if (item.kind !== "invoice-overdue") return draftFor(item, ctx);
  const i = item.invoice;
  return `Hi ${first} — ${from}. No rush at all, just keeping invoice ${
    i?.num ?? ""
  } on your radar. The pay link's in the earlier text whenever suits.`;
}
