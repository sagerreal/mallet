"use client";

/**
 * app/(field)/my-day/job-card.tsx — one stop on the day, as a card.
 *
 * CARDS ARE VISITS (visit-cards.ts derives them). The card shows what the row grammar could not:
 * who it's for, where to drive, how far along the stop is (the four-segment strip), and the one
 * live fact the strip can't say — "On site · since 12:38".
 *
 * The action row is the circle-with-label grammar. THE FILLED CIRCLE IS ALWAYS THE NEXT STEP:
 * Arrived while there's a drive outstanding, Done once on site. On my way is a courtesy, never a
 * gate — it sits unfilled at step 0 and disappears the moment it's sent (or the moment the tech
 * arrives, whichever happens first), because a tech in the driveway owes nobody a text.
 *
 * The WHOLE card opens the job sheet; the buttons stop propagation. Same .rowopen keyboard path
 * as the row it replaces: the container takes the mouse handler only, the title button carries
 * focus, so the action buttons are never nested inside a role=button.
 */

import { colLabel } from "@/components/modals/tech-job-modal/helpers";
import type { DayCard, CardStep } from "./visit-cards";

/** "08:30" → "8:30a" — wall-clock text, never parsed into a Date (zone-shift bug). */
export function timeLabel(hhmm: string | null): string {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":");
  const hr = Number(h);
  const mn = Number(m);
  if (!Number.isFinite(hr) || !Number.isFinite(mn)) return "—";
  const period = hr < 12 ? "a" : "p";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return mn > 0 ? `${display}:${String(mn).padStart(2, "0")}${period}` : `${display}${period}`;
}

/** An instant's local clock reading — the "since 12:38p" stamp. */
function sinceLabel(iso: string): string {
  const d = new Date(iso);
  const hr = d.getHours();
  const period = hr < 12 ? "a" : "p";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return `${display}:${String(d.getMinutes()).padStart(2, "0")}${period}`;
}

const STEP_WORDS: Record<CardStep, string> = {
  0: "Scheduled",
  1: "En route",
  2: "On site",
  3: "Done",
};

const ic = {
  directions: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10.2" r="2.6" />
    </svg>
  ),
  truck: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.8 6.6h11.4v9.2H1.8z" />
      <path d="M13.2 9.6h4.1l2.9 3v3.2h-7z" />
      <circle cx="6.4" cy="18.1" r="1.9" />
      <circle cx="16.6" cy="18.1" r="1.9" />
    </svg>
  ),
  arrow: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12h15.5M13.5 6l6 6-6 6" />
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 12.6l4.8 4.8L19.5 7.2" />
    </svg>
  ),
  dollar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.8v18.4" />
      <path d="M16.6 6.4c0-1.7-2-3-4.6-3s-4.6 1.3-4.6 3 1.6 2.8 4.6 3.2 4.9 1.5 4.9 3.4-2.2 3.2-4.9 3.2-4.9-1.4-4.9-3.1" />
    </svg>
  ),
};

/** The finished card's money slot — what the card can say without opening the sheet. */
export type CardMoney =
  | { kind: "collect"; label: string }
  | { kind: "paid"; label: string }
  | { kind: "office"; amount: string | null };

interface CircleActProps {
  label: string;
  icon: React.ReactNode;
  fill?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

interface MoneySlotProps {
  money: CardMoney | null;
  isPending: boolean;
  onCollect: (() => void) | null;
  onReceipt: (() => void) | null;
}

/** The finished card's money state, on the same foot row as the circles — the mock's grammar:
 *  Paid keeps its Receipt link, the office chip keeps the figure it was sent with. */
function MoneySlot({ money, isPending, onCollect, onReceipt }: MoneySlotProps) {
  if (!money) return null;
  if (money.kind === "collect") {
    if (!onCollect) return null;
    return <CircleAct label={money.label} icon={ic.dollar} fill disabled={isPending} onPress={onCollect} />;
  }
  if (money.kind === "paid") {
    return (
      <span className="mdc-money">
        <span className="stpill" style={{ color: "var(--ink)", background: "var(--manila-2)" }}>{money.label}</span>
        {onReceipt ? (
          <button type="button" className="linklike mdc-receipt" onClick={(e) => { e.stopPropagation(); onReceipt(); }}>
            Receipt
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="mdc-money">
      <span className="stpill" style={{ color: "var(--ink-2)", background: "var(--paper)" }}>Sent to the office</span>
      {money.amount ? <span className="mdc-money-amt">{money.amount}</span> : null}
    </span>
  );
}

function CircleAct({ label, icon, fill, disabled, onPress }: CircleActProps) {
  return (
    <button
      type="button"
      className={fill ? "fca fill" : "fca"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      <span className="fca-c">{icon}</span>
      <span className="fca-t">{label}</span>
    </button>
  );
}

export interface JobCardProps {
  card: DayCard;
  title: string;
  customerName: string | null;
  /** job.addr, falling back to the customer's own address. Null hides Directions — no dead buttons. */
  addr: string | null;
  callback: boolean;
  notes: string | null;
  isPending: boolean;
  onOpen: () => void;
  onDirections: (addr: string) => void;
  /** Null when the action does not apply to this card (job-level card, or step passed). */
  onMyWay: (() => void) | null;
  onArrived: (() => void) | null;
  onDone: (() => void) | null;
  /** The finished card's money slot; null renders nothing (live cards, redacted states). */
  money: CardMoney | null;
  onCollect: (() => void) | null;
  onReceipt: (() => void) | null;
}

export function JobCard({
  card,
  title,
  customerName,
  addr,
  callback,
  notes,
  isPending,
  onOpen,
  onDirections,
  onMyWay,
  onArrived,
  onDone,
  money,
  onCollect,
  onReceipt,
}: JobCardProps) {
  // TODAY PRINTS THE TIME ALONE; any other day prints its day above the hour (carried-over work
  // lands at the top of the route, and without the day it reads as this morning's first stop).
  const dayLabel = card.day ? colLabel(card.day) : colLabel(null);
  const showDay = card.day !== null && dayLabel !== "Today";
  const onSite = card.step === 2;

  return (
    <div className="card mdc" onClick={onOpen}>
      <div className="mdc-top">
        <h3 className="mdc-title">
          <button type="button" className="rowopen" aria-label={`Open ${title}`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            <b>{title}</b>
          </button>
        </h3>
        <div className="mdc-when">
          {card.day === null ? (
            <span className="md-day">{dayLabel}</span>
          ) : (
            <>
              {showDay ? <span className="md-day">{dayLabel}</span> : null}
              <span className="md-hh">{timeLabel(card.start)}</span>
            </>
          )}
        </div>
      </div>

      {customerName || callback ? (
        <div className="mdc-cust">
          {customerName}
          {callback ? (
            <span className="stpill" style={{ color: "var(--ink-2)", background: "var(--manila-2)" }}>
              Callback
            </span>
          ) : null}
        </div>
      ) : null}
      {addr ? <div className="mdc-addr">{addr}</div> : null}
      {notes ? <div className="mdc-addr">{notes}</div> : null}

      <div
        className="mdc-steps"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={card.step}
        aria-valuetext={STEP_WORDS[card.step]}
      >
        {([0, 1, 2, 3] as const).map((i) => (
          <i key={i} className={i <= card.step && (card.step > 0 || i === 0) ? "on" : undefined} />
        ))}
      </div>
      {onSite && card.startedAt ? (
        <div className="mdc-since">
          <i aria-hidden />
          On site · since {sinceLabel(card.startedAt)}
        </div>
      ) : null}

      <div className="fca-row">
        {addr ? (
          <CircleAct label="Directions" icon={ic.directions} onPress={() => onDirections(addr)} />
        ) : null}
        {onMyWay ? (
          <CircleAct label="On my way" icon={ic.truck} disabled={isPending} onPress={onMyWay} />
        ) : null}
        {onArrived ? (
          <CircleAct label="Arrived" icon={ic.arrow} fill disabled={isPending} onPress={onArrived} />
        ) : null}
        {onDone ? (
          <CircleAct
            label="Done"
            icon={ic.check}
            fill={card.step === 2}
            disabled={isPending}
            onPress={onDone}
          />
        ) : null}
        <MoneySlot money={money} isPending={isPending} onCollect={onCollect} onReceipt={onReceipt} />
      </div>
    </div>
  );
}
