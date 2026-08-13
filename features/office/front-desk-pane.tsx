"use client";

/**
 * features/office/front-desk-pane.tsx
 * The Front Desk tab, in the approved quiet register: a slim status header
 * (live dot · Answering · the provisioned number · Test call · Copy · switch),
 * the SERVICES ACCORDION as the page's main object (unchanged editor — job
 * type, triggers, certifications, ballpark, remove), and the booking rules as
 * a subordinate definition-list rail (Linear-properties pattern): label over
 * value, each row expanding its full existing editor in-flow. No chips, no
 * cards, no decoration. Emergency transfer ships in a follow-up (needs the
 * org-settings field + verify flow) — no dead controls here.
 */

import { useState } from "react";
import { AddressInput } from "@/components/ui/address-input";
import { DraftNumberInput } from "@/components/shared/draft-number-input";
import { useAppStore } from "@/lib/store/app-store";
import type { BookingCfg } from "@/lib/store/slices/settings-slice";
import type { BookingHours } from "@/lib/store/slices/settings-slice";
import { useMe } from "@/features/identity/hooks";
import { ServiceRow } from "@/app/(office)/settings/booking-service-card";
import { AddServiceModal, type NewServiceInput } from "@/app/(office)/settings/add-service-modal";
import { StarterPlaybookModal } from "@/app/(office)/settings/starter-playbook-modal";
import { playbookFor } from "@/app/(office)/settings/trade-playbooks";
import { TagInput } from "@/app/(office)/settings/tag-input";
import { HourSelect } from "@/app/(office)/settings/hour-select";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { useSaveFlash, SavedFlash } from "@/components/shared/save-flash";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { ListLoading } from "@/components/shared/list-loading";
import { fmtPhone } from "@/lib/format";
import { Field } from "@/components/ui/input";

/** Loose client-side gate for the transfer number — the server re-validates with the Phone VO. */
function isUsPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10;
}

function ruleCount(notServices: string, deferKeywords: string): number {
  return [notServices, deferKeywords]
    .flatMap((v) => v.split(/[,·]/))
    .map((t) => t.trim())
    .filter(Boolean).length;
}

function timeLabel(h: number): string {
  if (!h) return "closed";
  const period = h < 12 ? "a" : "p";
  const dh = h > 12 ? h - 12 : h;
  return `${dh}${period}`;
}

type RuleKey = "rules" | "fee" | "hours" | "area" | "transfer";

/**
 * One expandable rule row.
 *
 * MUST live at module scope. Defined inside FrontDeskPane it was a NEW function on every render,
 * so React saw a different component type each time and unmounted/remounted the whole subtree —
 * which meant every input inside a rule (the emergency transfer number, the office address, the
 * service fee) lost focus after a single keystroke and had to be clicked back into.
 */
function RuleRow({
  k,
  label,
  value,
  openRule,
  onToggle,
  children,
}: {
  k: RuleKey;
  label: string;
  value: React.ReactNode;
  openRule: RuleKey | null;
  onToggle: (k: RuleKey) => void;
  children: React.ReactNode;
}) {
  return (
    <DisclosureRow label={label} value={value} open={openRule === k} onToggle={() => onToggle(k)}>
      {children}
    </DisclosureRow>
  );
}

type HoursKey = Extract<keyof BookingHours, string>;

// Monday-first, the way a work week reads.
const DAY_ROWS: ReadonlyArray<{ label: string; oKey: HoursKey; cKey: HoursKey }> = [
  { label: "Monday", oKey: "monOpen", cKey: "monClose" },
  { label: "Tuesday", oKey: "tueOpen", cKey: "tueClose" },
  { label: "Wednesday", oKey: "wedOpen", cKey: "wedClose" },
  { label: "Thursday", oKey: "thuOpen", cKey: "thuClose" },
  { label: "Friday", oKey: "friOpen", cKey: "friClose" },
  { label: "Saturday", oKey: "satOpen", cKey: "satClose" },
  { label: "Sunday", oKey: "sunOpen", cKey: "sunClose" },
];

/**
 * One day's open/closed row. MUST be module scope — see RuleRow. Nested inside the component it
 * was a new function every render, remounting the selects mid-interaction.
 */
function HrRow({
  lbl,
  oKey,
  cKey,
  hours,
  setBookingHours,
  setBookingDayHours,
}: {
  lbl: string;
  oKey: HoursKey;
  cKey: HoursKey;
  hours: BookingHours;
  setBookingHours: (k: HoursKey, v: number) => void;
  setBookingDayHours: (o: HoursKey, c: HoursKey, open: number, close: number) => void;
}) {
  const ov = hours[oKey] ?? 0;
  const cv = hours[cKey] ?? 0;
  const isOpen = !(ov === 0 && cv === 0);
  return (
    // flexWrap so the time selects drop to a second line in a narrow pane instead of running
    // past the panel's right edge, which is what they were doing.
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-2) var(--space-3)", padding: "var(--space-2) 0" }}>
      <span style={{ flex: "none", minWidth: 84, fontWeight: 700, fontSize: "var(--type-base)" }}>{lbl}</span>
      <label className="switch">
        <input
          type="checkbox"
          checked={isOpen}
          onChange={(e) => {
            // Open + close in ONE persisted write — the domain rejects {open, close:0}.
            if (e.target.checked) setBookingDayHours(oKey, cKey, 8, 17);
            else setBookingDayHours(oKey, cKey, 0, 0);
          }}
        />
        <i />
      </label>
      {isOpen ? (
        <>
          <HourSelect
            value={ov}
            onChange={(h) => {
              // Keep the range forward; cross-over sets both atomically.
              if (h >= cv) setBookingDayHours(oKey, cKey, h, Math.min(h + 1, 24));
              else setBookingHours(oKey, h);
            }}
            min={0}
            max={23}
          />
          <span className="muted">to</span>
          <HourSelect value={cv} onChange={(h) => setBookingHours(cKey, h)} min={ov + 1} max={24} />
        </>
      ) : (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>Closed</span>
      )}
    </div>
  );
}

/** The missing pieces in the shop's own words — mirrors the sentence the server refuses with. */
const GAP_WORDS: Record<string, string> = {
  hours: "your opening hours",
  serviceArea: "your service area",
  services: "a bookable service",
};

function gapWords(missing: readonly string[]): string {
  const words = missing.map((m) => GAP_WORDS[m] ?? m);
  if (words.length <= 1) return words[0] ?? "the missing details";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What the front desk still needs before it can answer — computed from the LIVE store.
 *
 * The server's frontDeskReadiness is the authority and refuses an unready switch-on. This mirrors
 * it over the store's shape so the SCREEN can stay honest while the shop is typing, instead of
 * quoting a verdict from the last settings fetch. Any drift makes the affordance stricter or looser
 * for one render; it cannot let an unready desk actually switch on.
 */
function frontDeskGaps(bk: BookingCfg): string[] {
  const gaps: string[] = [];
  const h = bk.hours;
  const anyDay =
    h.monClose > h.monOpen || h.tueClose > h.tueOpen || h.wedClose > h.wedOpen ||
    h.thuClose > h.thuOpen || h.friClose > h.friOpen || h.satClose > h.satOpen ||
    h.sunClose > h.sunOpen;
  if (!anyDay) gaps.push("hours");
  if ((bk.area.originAddress ?? "").trim().length === 0) gaps.push("serviceArea");
  if (bk.services.length === 0) gaps.push("services");
  return gaps;
}

export function FrontDeskPane() {
  const setToggle = useAppStore((s) => s.setToggle);
  const frontDesk = useAppStore((s) => s.toggles.frontDesk);
  const bk = useAppStore((s) => s.booking);
  // Readiness read from the LIVE store, not the server's last snapshot.
  //
  // The server verdict (settings DTO → frontDeskReady) only refreshes when the settings query
  // refetches, so a shop that had just typed its service area still saw "not ready" — the screen
  // contradicted what was on it. The server remains the AUTHORITY (UpdateConfigUseCase refuses an
  // unready switch-on); this is the affordance, and it has to track what the user is looking at.
  const fdMissing = frontDeskGaps(bk);
  const fdReady = fdMissing.length === 0;
  const updateBookingService = useAppStore((s) => s.updateBookingService);
  const addBookingService = useAppStore((s) => s.addBookingService);
  const removeBookingService = useAppStore((s) => s.removeBookingService);
  const setServiceFee = useAppStore((s) => s.setServiceFee);
  const setFeeCredited = useAppStore((s) => s.setFeeCredited);
  const setBookingField = useAppStore((s) => s.setBookingField);
  const setBookingHours = useAppStore((s) => s.setBookingHours);
  const setBookingDayHours = useAppStore((s) => s.setBookingDayHours);
  const setBookingArea = useAppStore((s) => s.setBookingArea);

  // The address box is typed into, so it holds a draft and commits on select, Enter, or blur — the
  // store write geocodes server-side, and firing it per keystroke would geocode every partial
  // address. The radius beside it has no draft and commits on change; that asymmetry is the whole
  // reason this field needs the care below.
  const savedOrigin = bk.area.originAddress;
  const [originDraft, setOriginDraft] = useState(savedOrigin);

  // Adopt the stored address whenever it changes underneath the draft.
  //
  // THE BUG THIS FIXES. `useState` runs once, at mount — and this pane mounts BEFORE settings
  // hydrate (the shimmer below is an early return placed after every hook). So on a cold reload the
  // draft was seeded from `EMPTY_BOOKING`, the store then filled in with the real address, and this
  // field went on rendering "". The radius, which reads the store directly, showed its saved value.
  // A shop saw its address blank next to a radius that had survived and concluded the address had
  // not saved — when the DB held it the whole time.
  //
  // Render-phase sync rather than an effect: an effect would paint the empty box for one frame
  // first, which is the very thing that misled. Typing is safe — `savedOrigin` does not move while
  // a draft is uncommitted, so this only fires on a real store change (hydration, a commit, or a
  // rollback after a failed write, where showing the truth is right).
  const [originSeen, setOriginSeen] = useState(savedOrigin);
  if (savedOrigin !== originSeen) {
    setOriginSeen(savedOrigin);
    setOriginDraft(savedOrigin);
  }

  // Single-expanded service accordion — null = all collapsed
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  // Which rules-rail row is open for editing (one at a time), + the number/about reveal.
  const [openRule, setOpenRule] = useState<RuleKey | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);

  // The org's REAL provisioned number (E.164, null until provisioning lands).
  const me = useMe();
  const bizNumber = me.data?.twilioNumber ?? null;

  // Emergency transfer draft — commit-on-Save (never persist per keystroke: the
  // server rejects partial numbers and every reject would toast + roll back).
  const savedTransfer = bk.emergencyTransferNumber ?? "";
  const [transferDraft, setTransferDraft] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const transferFlash = useSaveFlash();

  function saveTransfer() {
    const draft = (transferDraft ?? savedTransfer).trim();
    if (draft !== "" && !isUsPhone(draft)) {
      setTransferError("Enter a real phone number — e.g. (925) 555-0123.");
      return;
    }
    setTransferError(null);
    setBookingField("emergencyTransferNumber", draft);
    setTransferDraft(null);
    transferFlash.flash();
  }
  const seedBookingServices = useAppStore((st) => st.seedBookingServices);
  const setTrade = useAppStore((st) => st.setTrade);

  function handleSeedTrade(tradeKey: string) {
    const playbook = playbookFor(tradeKey);
    if (!playbook) return;
    seedBookingServices(playbook.services);
    // `playbook.key`, NOT `playbook.label`. The label was passed here and nothing downstream
    // matched it: tradeMeasures() resolves the lowercase pricebook key, so "Plumbing" answered
    // false and this button wrote measurement_estimating=false to the database for every shop
    // that touched it. `setTrade` now takes a `TradeKey`, so a label is a compile error.
    if (tradeKey !== "other") setTrade(playbook.key);
  }

  // Modal-driven add: create the named service, then fill lane/price/description on the new
  // index (append order is stable — addBookingService pushes to the end).
  function handleAddService(svc: NewServiceInput) {
    const newIdx = bk.services.length;
    // The fee flag is the MODAL's answer, never a silent inherit — an "Estimate" pick meaning a
    // free quote must not leave the AI charging that caller the visit fee.
    addBookingService(svc.name, svc.feeApplies);
    updateBookingService(newIdx, "lane", svc.lane);
    if (svc.lane === "flat" && svc.price !== "") updateBookingService(newIdx, "price", svc.price);
    if (svc.triggers.trim()) updateBookingService(newIdx, "triggers", svc.triggers.trim());
  }

  function handleToggleService(i: number) {
    setExpandedIdx((prev) => (prev === i ? null : i));
  }

  function handleRemoveService(i: number) {
    removeBookingService(i);
    setExpandedIdx((prev) => (prev === i ? null : prev !== null && prev > i ? prev - 1 : prev));
  }

  const toggleRule = (k: RuleKey) => setOpenRule((prev) => (prev === k ? null : k));
  const wdLabel = `${timeLabel(bk.hours.wdOpen)}–${timeLabel(bk.hours.wdClose)} M–F`;

  // Cold reload: everything on this pane reads settings-slice state whose pre-hydration values
  // are plausible DEFAULTS, not empties — rendering them claims another shop's configuration
  // ("Answering" for a shop whose Front Desk is off, "Services 0", an $89 fee). Same query key
  // as SettingsHydrator, so React Query dedupes; until the first load lands, show the same
  // shimmer the code-split fallback uses rather than any default-derived claim.
  const settingsQ = api.v1.settings.get.useQuery(undefined, { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false });
  if (!settingsQ.isFetched && !settingsQ.isError) {
    return <ListLoading label="Loading Front Desk…" />;
  }



  // One definition-list row: label over value; click toggles its editor in-flow
  // below. Thin wrapper binding the shared DisclosureRow to this pane's
  // one-open-at-a-time rule state.
  return (
    <div style={{ maxWidth: 980 }}>
      {/* slim status header — the org's REAL number; a quiet provisioning line until it lands */}
      {/* Two semantic groups so the ≤760px grid can re-flow deliberately (title+number+toggle
          on the first row, action links on their own row) instead of the flex row wrapping
          mid-list and stranding "· about your number" beside the toggle. */}
      <div className="fdstatus">
        <span className={frontDesk && bizNumber ? "odot" : "odot off"} aria-hidden="true" />
        <span className="fdt">
          <span className="fds">
            {frontDesk
              ? bizNumber
                ? "Answering"
                : "Will answer once your number is live"
              : fdReady
                ? "Off — calls go to voicemail"
                : "Not set up yet"}
          </span>
          {/* What is still missing outranks the number: a shop that cannot answer needs to know
              WHY before it needs to know its number. */}
          {!fdReady && !frontDesk ? (
            <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
              Add {gapWords(fdMissing)} to turn this on.
            </span>
          ) : bizNumber ? (
            <span className="fdnum">{fmtPhone(bizNumber)}</span>
          ) : (
            <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
              Getting your number — we&rsquo;ll email you when it&rsquo;s live.
            </span>
          )}
        </span>
        <span className="fdacts">
          {bizNumber && (
            <>
              <span className="fdsep lead" aria-hidden="true">·</span>
              <a className="tedit" href={`tel:${bizNumber.replace(/[^\d]/g, "")}`}>Test call</a>
              <span className="fdsep" aria-hidden="true">·</span>
              <button className="tedit" onClick={() => navigator.clipboard.writeText(fmtPhone(bizNumber))}>Copy</button>
              <span className="fdsep" aria-hidden="true">·</span>
            </>
          )}
          <button className="tedit" onClick={() => setAboutOpen((v) => !v)}>{aboutOpen ? "close" : "about your number"}</button>
        </span>
        <span className="sp" />
        <label className="switch">
          <input
            type="checkbox"
            checked={frontDesk}
            // NOT `disabled`. A disabled control takes no focus, so clicking it never blurred the
            // address field above — the typed address stayed an uncommitted draft, readiness never
            // became true, and the switch could never enable. Typing the missing detail and
            // reaching for the switch, which is the whole point of the screen, deadlocked it.
            // Enabled with aria-disabled: the click lands, the address commits on blur, and the
            // reason is stated. The server refuses an unready switch-on regardless.
            aria-disabled={!frontDesk && !fdReady}
            onChange={(e) => {
              if (!frontDesk && !fdReady) return; // the blur has just committed; the gap stands
              setToggle("frontDesk", e.target.checked);
            }}
            aria-label="Front Desk on/off"
          />
          <i />
        </label>
      </div>

      {aboutOpen && (
        <div className="fdabout">
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0" }}>
            Your business line. Customers call &amp; text this; it rings your crew and every reply goes
            out as this number — personal cells stay private. Unknown number → Front Desk, handled as a
            lead. A <b>verified crew phone</b> → your assistant — never the Front Desk. Off — missed
            calls go to voicemail. On — they text back, parsed and held for your yes.
          </p>
          <div style={{ marginTop: "var(--space-3)" }}>
            <button className="btn sm" onClick={() => setForwardOpen((v) => !v)} aria-expanded={forwardOpen}>
              {forwardOpen ? "Hide forwarding steps" : "Forward your existing number"}
            </button>
            {/* Port-in is a roadmap item — no dead button for it (house rule). */}
          </div>
          {forwardOpen && (
            <div style={{ marginTop: "var(--space-3)", borderTop: "1px dashed var(--line)", paddingTop: "var(--space-3)" }}>
              <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-2)" }}>
                Keep the number your customers already know — forward it here and the Front Desk
                answers it.
              </p>
              <ol style={{ margin: "0", paddingLeft: "var(--space-5)", fontSize: "var(--type-sm)", color: "var(--ink-2)" }}>
                <li>From the phone that has your business number, dial your carrier&rsquo;s forwarding code
                  {" "}(most: <span className="mono">*72</span>, then{" "}
                  <span className="mono">{bizNumber ? fmtPhone(bizNumber) : "your Mallet number"}</span>).</li>
                <li>Or forward only unanswered calls (<span className="mono">*71</span> on most carriers) — you
                  pick up when you can, the Front Desk catches the rest.</li>
                <li>To stop forwarding, dial <span className="mono">*73</span>.</li>
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="fdcols">
        {/* main object: the services accordion, unchanged */}
        <div>
          {/* Polaris-style card header: title + count left, actions right — nothing floats. */}
          <div className="svccard">
            <div className="svccard-h">
              <b>Services</b>
              <span className="m">{bk.services.length}</span>
              <span className="sp" />
              <button className="btn sm ghost" onClick={() => setStarterOpen(true)}>Starter playbook</button>
              <button className="btn sm primary" onClick={() => setAddOpen(true)}>+ Add service</button>
            </div>
            {bk.services.map((s, i) => (
              <ServiceRow
                key={i}
                service={s}
                index={i}
                isExpanded={expandedIdx === i}
                onToggle={() => handleToggleService(i)}
                updateBookingService={updateBookingService}
                onRemove={() => handleRemoveService(i)}
                isLast={i === bk.services.length - 1}
                serviceFee={bk.serviceFee}
              />
            ))}
            {bk.services.length === 0 && (
              <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: "var(--type-md)", marginBottom: "var(--space-3)" }}>
                  Pick your trade to load starter services
                </div>
                <button className="btn primary" onClick={() => setStarterOpen(true)}>
                  Choose trade
                </button>
              </div>
            )}
          </div>
        </div>

        {/* subordinate rail: booking rules as a definition list */}
        <div className="fdrail">
          <h3>Booking rules</h3>

          <RuleRow k="rules" openRule={openRule} onToggle={toggleRule} label="Do not book" value={`${ruleCount(bk.notServices, bk.deferKeywords ?? "")} rules`}>
            <Field label="We don't do">
              <TagInput
                value={bk.notServices}
                onChange={(v) => setBookingField("notServices", v)}
                placeholder="Type a service and press Enter — e.g. new construction"
              />
            </Field>
            <Field label="Hand off to a person" style={{ marginBottom: "0" }}>
              <TagInput
                value={bk.deferKeywords ?? ""}
                onChange={(v) => setBookingField("deferKeywords", v)}
                placeholder="Type a word and press Enter — e.g. insurance, claim, warranty"
              />
            </Field>
          </RuleRow>

          <RuleRow k="fee" openRule={openRule} onToggle={toggleRule} label="Service call fee" value={<><span className="mono">${bk.serviceFee}</span>{bk.feeCredited ? " · credited" : ""}</>}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span className="muted">$</span>
              {/* onSettle, not onChange: setServiceFee persists the whole booking config, so
                  parse-on-keystroke wrote $1 then $12 on the way to $125 — navigating away
                  mid-type left the shop's diagnostic fee at $1 — and clearing the box to retype
                  stored $0 with no Save, no confirmation and no undo. onCommit keeps the rail's
                  preview live while typing; only blur reaches the server. */}
              <DraftNumberInput
                value={bk.serviceFee}
                onSettle={setServiceFee}
                aria-label="Service call fee in dollars"
                placeholder="0"
                style={{ width: 110, border: "1.5px solid var(--line)", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-md)", background: "var(--card)" }}
              />
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>to come diagnose a repair</span>
            </div>
            <div className="stage-row" style={{ marginTop: "var(--space-3)" }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontWeight: 700, fontSize: "var(--type-base)" }}>Credited toward the work</b>
                <div className="muted" style={{ fontSize: "var(--type-sm)" }}>Comes off the price if they approve the repair.</div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={bk.feeCredited} onChange={(e) => setFeeCredited(e.target.checked)} />
                <i />
              </label>
            </div>
          </RuleRow>

          <RuleRow k="hours" openRule={openRule} onToggle={toggleRule} label="Business hours" value={<span className="mono">{wdLabel}</span>}>
            {/* Every day its own row. "Weekdays" could not express a shop that closes at noon on
                Friday, which is most of them. */}
            {DAY_ROWS.map((d) => (
              <HrRow
                key={d.oKey}
                lbl={d.label}
                oKey={d.oKey}
                cKey={d.cKey}
                hours={bk.hours}
                setBookingHours={setBookingHours}
                setBookingDayHours={setBookingDayHours}
              />
            ))}
          </RuleRow>

          <RuleRow
            k="transfer"
            openRule={openRule}
            onToggle={toggleRule}
            label="Emergency transfer"
            value={savedTransfer ? <span className="mono">{fmtPhone(savedTransfer)}</span> : "Off"}
          >
            <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-3)" }}>
              A true emergency on the line transfers live to this number — usually the owner&rsquo;s or
              the on-call cell. Empty = off; emergencies become an urgent callback instead.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <input
                type="tel"
                inputMode="tel"
                aria-label="Emergency transfer number"
                placeholder="(925) 555-0123"
                value={transferDraft ?? savedTransfer}
                onChange={(e) => {
                  setTransferDraft(e.target.value);
                  if (transferError) setTransferError(null);
                  transferFlash.reset();
                }}
                className="field-compact"
                style={{ width: 180 }}
              />
              <button className="btn sm primary" onClick={saveTransfer} disabled={transferDraft === null}>
                Save
              </button>
              <SavedFlash saved={transferFlash.saved} />
            </div>
            {transferError && (
              <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{transferError}</p>
            )}
          </RuleRow>

          <RuleRow k="area" openRule={openRule} onToggle={toggleRule} label="Service area" value={<span className="mono">{bk.area.radiusMi} mi</span>}>
            <Field label="Office address" style={{ margin: "0" }}>
              {/* The same lookup the customer sheet uses. This was a plain text box, so an office
                  address could be typed any way at all — and it is the point the service-area
                  radius is measured FROM, geocoded server-side on save. A typo here does not look
                  broken; it quietly moves the centre of the shop's coverage. Suggestions render
                  in-flow under the input, never floating. */}
              <AddressInput
                value={originDraft}
                onChange={setOriginDraft}
                onSelect={(v) => { setOriginDraft(v); setBookingArea("originAddress", v); }}
                onCommit={() => setBookingArea("originAddress", originDraft)}
                onBlur={() => setBookingArea("originAddress", originDraft)}
                placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
                aria-label="Office address"
                inputStyle={{ width: "100%", minHeight: 44, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "0 var(--space-3)", fontSize: "var(--type-base)" }}
              />
              {/* The behaviour was already correct — isInServiceArea returns "unknown" and the call
                  books normally — but nothing said so, and an owner reasonably assumes a blank
                  address means calls get turned away. */}
              {!bk.area.originAddress.trim() && (
                <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}>
                  Not set — the front desk books any address. Add one to turn away jobs outside the radius.
                </p>
              )}
            </Field>
            <Field label="Radius (miles)" style={{ margin: "var(--space-3) 0 0" }}>
              <input type="number" inputMode="decimal" min={0} defaultValue={bk.area.radiusMi}
                onChange={(e) => setBookingArea("radiusMi", e.target.value)}
                style={{ fontSize: "var(--type-base)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)", maxWidth: 120 }} />
            </Field>
          </RuleRow>
        </div>
      </div>

      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddService} />
      <StarterPlaybookModal open={starterOpen} onClose={() => setStarterOpen(false)} onSeed={handleSeedTrade} />
    </div>
  );
}
