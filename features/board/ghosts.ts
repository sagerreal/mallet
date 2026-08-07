/**
 * features/board/ghosts.ts
 * THE FOUR EXAMPLE CARDS a brand-new shop's board is drawn with.
 *
 * A shop on day one has nothing open, and four empty columns are not a neutral screen — they read
 * as a board that failed to load. One dimmed, dashed EXAMPLE card per column says instead: this is
 * the shape your work will take, and this is the column it lands in.
 *
 * These are NOT sample data. Nothing here is written, fetched, counted or opened: the cards are
 * `aria-hidden`, handler-free markup rendered from these constants (see work-board.tsx), and they
 * disappear the moment the shop has one real row. That distinction is what keeps this on the right
 * side of the no-seed-data rule, so the three properties that enforce it are non-negotiable — the
 * EXAMPLE tag, the hidden-from-assistive-tech flag, and the total absence of a price.
 *
 * NO MONEY, deliberately. A dollar figure is the one thing on a card an owner reads as a fact
 * about their own business; inventing one on the first screen would be a lie told in the app's own
 * voice. The columns state 0 for the same reason.
 *
 * Data only — no React, no store, no query.
 */

import type { BoardColumnId, BoardTone } from "./types";

/**
 * One drawn card. The fields mirror `BoardItem`'s visible face minus everything that identifies a
 * record: `badge` is the live card's `stateLabel` (where the work stands) and `state` is its
 * `ageLabel` (the line beside it). There is no `valueDollars` here and there never should be.
 */
export interface GhostCard {
  readonly name: string;
  readonly service: string;
  /** The tone badge's words — "Needs response", "Scheduled", … */
  readonly badge: string;
  readonly tone: BoardTone;
  /** The trailing meta line — when it landed, or when it's due. */
  readonly state: string;
}

/** The word the card is tagged with. Uppercased in CSS; asserted in this casing. */
export const GHOST_TAG = "Example";

/**
 * One per column, from the approved mockup. The tones follow the live board's own rule rather
 * than being picked for looks: amber wherever the SHOP owes the next move, neutral where somebody
 * else does — so the first thing a new owner learns from the board is what amber means.
 */
export const GHOST_CARDS: Record<BoardColumnId, GhostCard> = {
  requests: {
    name: "Dana Ruiz",
    service: "Water heater leaking",
    badge: "Needs response",
    tone: "attention",
    state: "Called 5m ago",
  },
  quoting: {
    name: "Marcus Lee",
    service: "Primary bath remodel",
    badge: "Quote in progress",
    tone: "attention",
    state: "Draft · unsent",
  },
  jobs: {
    name: "Kim Patel",
    service: "Main drain cleaning",
    badge: "Scheduled",
    tone: "waiting",
    state: "Fri · 9:00 AM",
  },
  billing: {
    name: "Alex Moro",
    service: "Kitchen faucet repair",
    badge: "Ready to bill",
    tone: "attention",
    state: "Done today",
  },
};
