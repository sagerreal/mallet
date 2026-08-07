/**
 * features/board/board-card.tsx
 * ONE OPEN PIECE OF WORK, ON ONE CARD: who it's for, what it's worth, what it is, where it stands,
 * and how long it's been there. Nothing is derived here — every field is a fact `derive.ts` already
 * settled, so the card and the record it opens can never disagree.
 *
 * When the row carries a prepared reminder (`item.ok`) the card also carries the TEXT ITSELF, one
 * click from sent. That is the board's whole reason to exist: the owner reads a fact and finishes
 * it in the same gesture, without opening anything.
 */

"use client";

import { fmt$ } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { firstName } from "@/features/home/derive";
import { draftFor, type DraftContext } from "@/features/home/drafts";
import { SendBlock } from "@/features/home/send-block";
import { SMS_NOT_READY_REASON } from "@/features/a2p/use-sms-ready";
import type { BoardItem, BoardTone } from "./types";

/**
 * How a tone reads in ink. The one place the board's four tones become colour — amber is the
 * shop's own move, red is a date the customer already agreed to and missed, blue is a crew moving
 * right now, grey is somebody else's turn.
 */
export const BADGE_TONE: Record<BoardTone, BadgeTone> = {
  attention: "amber",
  overdue: "red",
  active: "blue",
  waiting: "neutral",
};

/** The caption over an on-card draft: what it is, and that it is ready. */
const DRAFT_LABEL = "Text · ready to send";

export function BoardCard({
  item,
  smsReady,
  onOpen,
  ctx = {},
}: {
  item: BoardItem;
  /** false ⇒ Send is disabled with its reason. The draft still renders. */
  smsReady: boolean;
  onOpen(item: BoardItem): void;
  /** The org/owner names the drafts sign off with — the dashboard already computes them. */
  ctx?: DraftContext;
}) {
  const open = () => onOpen(item);

  return (
    // `.rowopen`: the card keeps its mouse onClick and delegates KEYBOARD access to the focusable
    // name button below, rather than becoming a button full of buttons (docs/design-system.md §3).
    <div className="kcard" onClick={open}>
      <div className="nm">
        <button type="button" className="cname rowopen" onClick={(e) => { e.stopPropagation(); open(); }}>
          {item.name}
        </button>
        {/* 0 is UNPRICED, not free: a card that read "$0" would state a price nobody quoted. */}
        {item.valueDollars > 0 && <span className="kval fig">{fmt$(item.valueDollars)}</span>}
      </div>

      {/* Request rows reach the board without a service line (the list DTO has no title for a
          lead's own words yet) — no line at all beats an empty one holding open a gap. */}
      {item.service.trim() !== "" && <div className="kjob">{item.service}</div>}

      <div className="ktrace kmeta">
        <Badge tone={BADGE_TONE[item.tone]}>{item.stateLabel}</Badge>
        {item.ageLabel !== "" && <span className="fig">{item.ageLabel}</span>}
      </div>

      {item.ok && (
        <SendBlock
          item={item.ok}
          fallback={{ leadId: item.ok.lead.id, first: firstName(item.ok.lead.name), age: item.ok.lead.age }}
          initial={draftFor(item.ok, ctx)}
          label={DRAFT_LABEL}
          // "Change" opens the RECORD, not an inline editor: on this board the words are a
          // by-product of the quote or the bill, and changing them usually means changing that.
          secondary={{ label: "Change", onClick: open }}
          blockedReason={smsReady ? undefined : SMS_NOT_READY_REASON}
        />
      )}
    </div>
  );
}
