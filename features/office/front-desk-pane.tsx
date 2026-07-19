"use client";

/**
 * features/office/front-desk-pane.tsx
 * The Front Desk tab of the Office page. A designed layer over the SAME editors
 * the old /frontdesk page had — nothing removed: status row (live dot + number +
 * copy + on/off switch), an expandable "about your number" panel (explainers +
 * the deferred forward/port actions), then four tracker cards whose summaries
 * read at a blur (chips / figure / week bars) and whose Edit reveals the full
 * existing editor in-flow (services & routing accordion + modals, call-rule tag
 * inputs, fee + credited toggle, hours grid + service area).
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { ServiceRow } from "@/app/(office)/settings/booking-service-card";
import { AddServiceModal, type NewServiceInput } from "@/app/(office)/settings/add-service-modal";
import { StarterPlaybookModal } from "@/app/(office)/settings/starter-playbook-modal";
import { playbookFor } from "@/app/(office)/settings/trade-playbooks";
import { TagInput } from "@/app/(office)/settings/tag-input";
import { HourSelect } from "@/app/(office)/settings/hour-select";

// Tracker card: summary always visible; Edit toggles the full editor in-flow (no floating UI).
function TrackerCard({ title, meta, summary, open, onToggle, children }: {
  title: string;
  meta?: string;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={open ? "tcard open" : "tcard"}>
      <div className="th">
        <b>{title}</b>
        <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          {meta && <span className="tm">{meta}</span>}
          <button className="tedit" onClick={onToggle}>{open ? "done" : "edit"}</button>
        </span>
      </div>
      {summary}
      {open && <div className="tbody">{children}</div>}
    </div>
  );
}

const MALLET_NUMBER = "(925) 555-0100";

function callRulesSummary(notServices: string, deferKeywords: string): string {
  const count = [notServices, deferKeywords]
    .flatMap((v) => v.split(/[,\u00b7]/))
    .map((t) => t.trim())
    .filter(Boolean).length;
  return `${count} rule${count === 1 ? "" : "s"}`;
}

function timeLabel(h: number): string {
  if (!h) return "closed";
  const period = h < 12 ? "a" : "p";
  const dh = h > 12 ? h - 12 : h;
  return `${dh}${period}`;
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
    // If we just removed the expanded one, collapse
    setExpandedIdx((prev) => (prev === i ? null : prev !== null && prev > i ? prev - 1 : prev));
  }

  const wdLabel = `${timeLabel(bk.hours.wdOpen)}–${timeLabel(bk.hours.wdClose)} wkdays`;

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
              // Set open + close in ONE persisted write so the row never round-trips through the
              // invalid {open:8, close:0} the domain now rejects (which read as a closed day and
              // sent every voice caller to voicemail).
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
                // Keep the range valid: close stays after open (an inverted range reads as a
                // closed day to the slot math, silently killing that day's availability — and the
                // domain now rejects it). When the new open would cross close, set BOTH atomically
                // so we never persist the invalid intermediate; otherwise just move open.
                if (h >= cv) setBookingDayHours(oKey, cKey, h, Math.min(h + 1, 24));
                else setBookingHours(oKey, h);
              }}
              min={0}
              max={23}
            />
            <span className="muted">to</span>
            <HourSelect
              value={cv}
              onChange={(h) => setBookingHours(cKey, h)}
              min={ov + 1}
              max={24}
            />
          </>
        ) : (
          <span className="muted" style={{ fontSize: "11.5px" }}>Closed</span>
        )}
      </div>
    );
  }

  // Which tracker card is open for editing (one at a time), + the number/about reveal.
  const [openCard, setOpenCard] = useState<"services" | "rules" | "fee" | "hours" | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const toggleCard = (k: "services" | "rules" | "fee" | "hours") =>
    setOpenCard((prev) => (prev === k ? null : k));

  const LANE_LABEL: Record<string, string> = { repair: "REP", estimate: "EST", flat: "FLAT" };
  const ruleChips = [
    ...bk.notServices.split(/[,\u00b7]/).map((t) => ({ t: t.trim(), defer: false })),
    ...(bk.deferKeywords ?? "").split(/[,\u00b7]/).map((t) => ({ t: t.trim(), defer: true })),
  ].filter((r) => r.t);

  const dayOpen = (o: number, c: number) => o < c;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* status row — the shop's heartbeat */}
      <div className="fdstatus">
        <span className={frontDesk ? "odot" : "odot off"} aria-hidden="true" />
        <span className="fds">{frontDesk ? "Answering" : "Off — calls go to voicemail"}</span>
        <span className="fdnum">{MALLET_NUMBER}</span>
        <button className="btn sm ghost" onClick={() => navigator.clipboard.writeText(MALLET_NUMBER)}>Copy</button>
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

      <div className="fdgrid">
        <TrackerCard
          title="Answers for"
          meta={`${bk.services.length} services`}
          open={openCard === "services"}
          onToggle={() => toggleCard("services")}
          summary={
            <div className="tchips">
              {bk.services.slice(0, 4).map((s, i) => (
                <span key={i} className="tchip">{s.name} <span className="lane">{LANE_LABEL[s.lane] ?? s.lane}</span></span>
              ))}
              {bk.services.length > 4 && <span className="tchip">+{bk.services.length - 4} more</span>}
              {bk.services.length === 0 && <span className="tsub">No services yet — edit to pick your trade.</span>}
            </div>
          }
        >
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
            <button className="btn ghost" onClick={() => setStarterOpen(true)}>Starter playbook</button>
            <button className="btn primary" onClick={() => setAddOpen(true)}>+ Add service</button>
          </div>
          <div style={{ border: "1px solid var(--line-2, var(--line))", borderRadius: 8, overflow: "hidden", marginBottom: 4 }}>
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
        </TrackerCard>

        <TrackerCard
          title={"Won't touch"}
          meta={callRulesSummary(bk.notServices, bk.deferKeywords ?? "")}
          open={openCard === "rules"}
          onToggle={() => toggleCard("rules")}
          summary={
            <div className="tchips">
              {ruleChips.slice(0, 4).map((r, i) => (
                <span key={i} className="tchip neg">{r.t}{r.defer ? " \u2192 person" : ""}</span>
              ))}
              {ruleChips.length > 4 && <span className="tchip neg">+{ruleChips.length - 4}</span>}
              {ruleChips.length === 0 && <span className="tsub">No rules yet.</span>}
            </div>
          }
        >
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
        </TrackerCard>

        <TrackerCard
          title="Service call"
          open={openCard === "fee"}
          onToggle={() => toggleCard("fee")}
          summary={
            <div>
              <span className="tfig">${bk.serviceFee}</span>
              <div className="tsub">{bk.feeCredited ? "credited toward the job" : "kept — not credited"}</div>
            </div>
          }
        >
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
              <input type="checkbox" checked={bk.feeCredited}
                onChange={(e) => setFeeCredited(e.target.checked)} />
              <i />
            </label>
          </div>
        </TrackerCard>

        <TrackerCard
          title="Hours & area"
          meta={wdLabel}
          open={openCard === "hours"}
          onToggle={() => toggleCard("hours")}
          summary={
            <div>
              <div className="oweek">
                {([
                  ["M", dayOpen(bk.hours.wdOpen, bk.hours.wdClose)],
                  ["T", dayOpen(bk.hours.wdOpen, bk.hours.wdClose)],
                  ["W", dayOpen(bk.hours.wdOpen, bk.hours.wdClose)],
                  ["T", dayOpen(bk.hours.wdOpen, bk.hours.wdClose)],
                  ["F", dayOpen(bk.hours.wdOpen, bk.hours.wdClose)],
                  ["S", dayOpen(bk.hours.satOpen, bk.hours.satClose)],
                  ["S", dayOpen(bk.hours.sunOpen, bk.hours.sunClose)],
                ] as const).map(([lb, on], i) => (
                  <span key={i} className="d"><span className={on ? "bar" : "bar off"} /><span className="lb">{lb}</span></span>
                ))}
              </div>
              <div className="tsub" style={{ marginTop: 7 }}>{bk.area.radiusMi} mi service radius</div>
            </div>
          }
        >
          <div style={{fontSize:11, textTransform:"uppercase", letterSpacing:".04em", margin:"2px 0 8px"}} className="muted">Business hours</div>
          <div>
            <HrRow lbl="Weekdays" oKey="wdOpen" cKey="wdClose" />
            <HrRow lbl="Saturday" oKey="satOpen" cKey="satClose" />
            <HrRow lbl="Sunday"   oKey="sunOpen" cKey="sunClose" />
          </div>
          <div style={{fontSize:11, textTransform:"uppercase", letterSpacing:".04em", margin:"14px 0 8px"}} className="muted">Service area</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, maxWidth: 640 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Office address</label>
              <input type="text" defaultValue={bk.area.originAddress}
                onChange={(e) => setBookingArea("originAddress", e.target.value)}
                placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
                style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8 }} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Radius (miles)</label>
              <input type="number" min={0} defaultValue={bk.area.radiusMi}
                onChange={(e) => setBookingArea("radiusMi", e.target.value)}
                style={{ fontSize: 13.5, padding: "8px 10px", borderRadius: 8 }} />
            </div>
          </div>
        </TrackerCard>
      </div>

      <AddServiceModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddService} />
      <StarterPlaybookModal open={starterOpen} onClose={() => setStarterOpen(false)} onSeed={handleSeedTrade} />
    </div>
  );
}
