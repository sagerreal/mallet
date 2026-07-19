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
import { ServiceRow } from "@/app/(office)/settings/booking-service-card";
import { AddServiceModal, type NewServiceInput } from "@/app/(office)/settings/add-service-modal";
import { StarterPlaybookModal } from "@/app/(office)/settings/starter-playbook-modal";
import { playbookFor } from "@/app/(office)/settings/trade-playbooks";
import { TagInput } from "@/app/(office)/settings/tag-input";
import { HourSelect } from "@/app/(office)/settings/hour-select";

const MALLET_NUMBER = "(925) 555-0100";

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

type RuleKey = "rules" | "fee" | "hours" | "area";

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

  type HoursKey = keyof typeof bk.hours;

  function HrRow({ lbl, oKey, cKey }: { lbl: string; oKey: HoursKey; cKey: HoursKey }) {
    const ov = bk.hours[oKey];
    const cv = bk.hours[cKey];
    const isOpen = !(ov === 0 && cv === 0);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
        <span style={{ minWidth: 84, fontWeight: 700, fontSize: 13.5 }}>{lbl}</span>
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
          <span className="muted" style={{ fontSize: "11.5px" }}>Closed</span>
        )}
      </div>
    );
  }

  // One definition-list row: label over value; click toggles its editor in-flow below.
  function RuleRow({ k, label, value, children }: { k: RuleKey; label: string; value: React.ReactNode; children: React.ReactNode }) {
    const open = openRule === k;
    return (
      <div className={open ? "fdd open" : "fdd"}>
        <button className="fdd-head" onClick={() => toggleRule(k)} aria-expanded={open}>
          <span className="fdd-l">{label}</span>
          <span className="fdd-v">{value}</span>
        </button>
        {open && <div className="fdd-body">{children}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980 }}>
      {/* slim status header */}
      <div className="fdstatus">
        <span className={frontDesk ? "odot" : "odot off"} aria-hidden="true" />
        <span className="fds">{frontDesk ? "Answering" : "Off — calls go to voicemail"}</span>
        <span className="fdnum">{MALLET_NUMBER}</span>
        <span className="fdsep" aria-hidden="true">·</span>
        <a className="tedit" href={`tel:${MALLET_NUMBER.replace(/[^\d]/g, "")}`}>Test call</a>
        <span className="fdsep" aria-hidden="true">·</span>
        <button className="tedit" onClick={() => navigator.clipboard.writeText(MALLET_NUMBER)}>Copy</button>
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
          <p className="muted" style={{ fontSize: "11.5px", margin: 0 }}>
            Your business line. Customers call &amp; text this; it rings your crew and every reply goes
            out as this number — personal cells stay private. Unknown number → Front Desk, handled as a
            lead. A <b>verified crew phone</b> → your assistant — never the Front Desk. Off — missed
            calls go to voicemail. On — they text back, parsed and held for your yes.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap" }}>
            {/* deferred: external integration (forward existing number) */}
            <button className="btn sm" onClick={() => {}}>Forward your existing number</button>
            {/* deferred: external integration (port number in) */}
            <button className="btn sm ghost" onClick={() => {}}>Port your number in</button>
          </div>
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
              />
            ))}
            {bk.services.length === 0 && (
              <div style={{ padding: "22px 14px", textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
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

          <RuleRow k="rules" label="Do not book" value={`${ruleCount(bk.notServices, bk.deferKeywords ?? "")} rules`}>
            <div className="field">
              <label>We don&apos;t do</label>
              <TagInput
                value={bk.notServices}
                onChange={(v) => setBookingField("notServices", v)}
                placeholder="Type a service and press Enter — e.g. new construction"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Hand off to a person</label>
              <TagInput
                value={bk.deferKeywords ?? ""}
                onChange={(v) => setBookingField("deferKeywords", v)}
                placeholder="Type a word and press Enter — e.g. insurance, claim, warranty"
              />
            </div>
          </RuleRow>

          <RuleRow k="fee" label="Service call fee" value={<><span className="mono">${bk.serviceFee}</span>{bk.feeCredited ? " · credited" : ""}</>}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="muted">$</span>
              <input type="number" min={0} defaultValue={bk.serviceFee}
                onChange={(e) => setServiceFee(Number(e.target.value))}
                style={{ width: 110, border: "1.5px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, background: "var(--card)" }} />
              <span className="muted" style={{ fontSize: 12 }}>to come diagnose a repair</span>
            </div>
            <div className="stage-row" style={{ marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontWeight: 700, fontSize: "13.5px" }}>Credited toward the work</b>
                <div className="muted" style={{ fontSize: "11.5px" }}>Comes off the price if they approve the repair.</div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={bk.feeCredited} onChange={(e) => setFeeCredited(e.target.checked)} />
                <i />
              </label>
            </div>
          </RuleRow>

          <RuleRow k="hours" label="Business hours" value={<span className="mono">{wdLabel}</span>}>
            <HrRow lbl="Weekdays" oKey="wdOpen" cKey="wdClose" />
            <HrRow lbl="Saturday" oKey="satOpen" cKey="satClose" />
            <HrRow lbl="Sunday"   oKey="sunOpen" cKey="sunClose" />
          </RuleRow>

          <RuleRow k="area" label="Service area" value={<span className="mono">{bk.area.radiusMi} mi</span>}>
            <div className="field" style={{ margin: 0 }}>
              <label>Office address</label>
              <input type="text" defaultValue={bk.area.originAddress}
                onChange={(e) => setBookingArea("originAddress", e.target.value)}
                placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
                style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8 }} />
            </div>
            <div className="field" style={{ margin: "10px 0 0" }}>
              <label>Radius (miles)</label>
              <input type="number" min={0} defaultValue={bk.area.radiusMi}
                onChange={(e) => setBookingArea("radiusMi", e.target.value)}
                style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8, maxWidth: 120 }} />
            </div>
          </RuleRow>
        </div>
      </div>

      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddService} />
      <StarterPlaybookModal open={starterOpen} onClose={() => setStarterOpen(false)} onSeed={handleSeedTrade} />
    </div>
  );
}
