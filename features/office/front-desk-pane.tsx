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
import { useAppStore } from "@/lib/store/app-store";
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
import { fmtPhone } from "@/lib/format";

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

export function FrontDeskPane() {
  const setToggle = useAppStore((s) => s.setToggle);
  const frontDesk = useAppStore((s) => s.toggles.frontDesk);
  const bk = useAppStore((s) => s.booking);
  const updateBookingService = useAppStore((s) => s.updateBookingService);
  const addBookingService = useAppStore((s) => s.addBookingService);
  const removeBookingService = useAppStore((s) => s.removeBookingService);
  const setServiceFee = useAppStore((s) => s.setServiceFee);
  const setFeeCredited = useAppStore((s) => s.setFeeCredited);
  const setBookingField = useAppStore((s) => s.setBookingField);
  const setBookingHours = useAppStore((s) => s.setBookingHours);
  const setBookingDayHours = useAppStore((s) => s.setBookingDayHours);
  const setBookingArea = useAppStore((s) => s.setBookingArea);

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
    if (tradeKey !== "other") setTrade(playbook.label);
  }

  // Modal-driven add: create the named service, then fill lane/price/description on the new
  // index (append order is stable — addBookingService pushes to the end).
  function handleAddService(svc: NewServiceInput) {
    const newIdx = bk.services.length;
    addBookingService(svc.name);
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



  // One definition-list row: label over value; click toggles its editor in-flow
  // below. Thin wrapper binding the shared DisclosureRow to this pane's
  // one-open-at-a-time rule state.
  return (
    <div style={{ maxWidth: 980 }}>
      {/* slim status header — the org's REAL number; a quiet provisioning line until it lands */}
      <div className="fdstatus">
        <span className={frontDesk ? "odot" : "odot off"} aria-hidden="true" />
        <span className="fds">{frontDesk ? "Answering" : "Off — calls go to voicemail"}</span>
        {bizNumber ? (
          <>
            <span className="fdnum">{fmtPhone(bizNumber)}</span>
            <span className="fdsep" aria-hidden="true">·</span>
            <a className="tedit" href={`tel:${bizNumber.replace(/[^\d]/g, "")}`}>Test call</a>
            <span className="fdsep" aria-hidden="true">·</span>
            <button className="tedit" onClick={() => navigator.clipboard.writeText(fmtPhone(bizNumber))}>Copy</button>
          </>
        ) : (
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            Getting your number — we&rsquo;ll email you when it&rsquo;s live.
          </span>
        )}
        <span className="fdsep" aria-hidden="true">·</span>
        <button className="tedit" onClick={() => setAboutOpen((v) => !v)}>{aboutOpen ? "close" : "about your number"}</button>
        <span className="sp" />
        <label className="switch">
          <input type="checkbox" checked={frontDesk} onChange={(e) => setToggle("frontDesk", e.target.checked)} aria-label="Front Desk on/off" />
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
            <div className="field">
              <label>We don&apos;t do</label>
              <TagInput
                value={bk.notServices}
                onChange={(v) => setBookingField("notServices", v)}
                placeholder="Type a service and press Enter — e.g. new construction"
              />
            </div>
            <div className="field" style={{ marginBottom: "0" }}>
              <label>Hand off to a person</label>
              <TagInput
                value={bk.deferKeywords ?? ""}
                onChange={(v) => setBookingField("deferKeywords", v)}
                placeholder="Type a word and press Enter — e.g. insurance, claim, warranty"
              />
            </div>
          </RuleRow>

          <RuleRow k="fee" openRule={openRule} onToggle={toggleRule} label="Service call fee" value={<><span className="mono">${bk.serviceFee}</span>{bk.feeCredited ? " · credited" : ""}</>}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span className="muted">$</span>
              <input type="number" inputMode="decimal" min={0} defaultValue={bk.serviceFee}
                onChange={(e) => setServiceFee(Number(e.target.value))}
                style={{ width: 110, border: "1.5px solid var(--line)", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-md)", background: "var(--card)" }} />
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
            <div className="field" style={{ margin: "0" }}>
              <label>Office address</label>
              <input type="text" defaultValue={bk.area.originAddress}
                onChange={(e) => setBookingArea("originAddress", e.target.value)}
                placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
                style={{ fontSize: "var(--type-base)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)" }} />
              {/* The behaviour was already correct — isInServiceArea returns "unknown" and the call
                  books normally — but nothing said so, and an owner reasonably assumes a blank
                  address means calls get turned away. */}
              {!bk.area.originAddress.trim() && (
                <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}>
                  Not set — the front desk books any address. Add one to turn away jobs outside the radius.
                </p>
              )}
            </div>
            <div className="field" style={{ margin: "var(--space-3) 0 0" }}>
              <label>Radius (miles)</label>
              <input type="number" inputMode="decimal" min={0} defaultValue={bk.area.radiusMi}
                onChange={(e) => setBookingArea("radiusMi", e.target.value)}
                style={{ fontSize: "var(--type-base)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)", maxWidth: 120 }} />
            </div>
          </RuleRow>
        </div>
      </div>

      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddService} />
      <StarterPlaybookModal open={starterOpen} onClose={() => setStarterOpen(false)} onSeed={handleSeedTrade} />
    </div>
  );
}
