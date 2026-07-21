"use client";

// Onboarding step modals for the Home setup checklist. Each Tier-1 step completes IN PLACE
// (no navigating to Settings). They write through the same store actions the Settings tab uses,
// so state stays a single source of truth. Reuses the app Modal shell + .field/.seg system.

import Link from "next/link";
import { Modal } from "@/components/modals/modal";
import { useAppStore } from "@/lib/store/app-store";
import { HourSelect } from "@/app/(office)/settings/hour-select";

const INPUT: React.CSSProperties = { fontSize: "var(--type-base)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)" };

// ── Office & hours ───────────────────────────────────────────────────────────

export function OfficeHoursModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const area = useAppStore((s) => s.booking.area);
  const hours = useAppStore((s) => s.booking.hours);
  const setBookingArea = useAppStore((s) => s.setBookingArea);
  const setBookingHours = useAppStore((s) => s.setBookingHours);

  const wdOpen = hours.wdOpen;
  const wdClose = hours.wdClose;
  const wdWorking = !(wdOpen === 0 && wdClose === 0);

  return (
    <Modal open={open} onClose={onClose} maxWidth={480}>
      <h3 style={{ margin: "0 0 var(--space-1)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        Your office &amp; hours
      </h3>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>
        The AI only books jobs within range of your office, during your hours.
      </p>

      <div className="field">
        <label>Office address</label>
        <input
          type="text"
          defaultValue={area.originAddress}
          onChange={(e) => setBookingArea("originAddress", e.target.value)}
          placeholder="e.g. 200 Ray St, Pleasanton, CA 94566"
          style={INPUT}
        />
      </div>

      <div className="field" style={{ maxWidth: 200 }}>
        <label>Service radius (miles)</label>
        <input
          type="number"
          min={0}
          defaultValue={area.radiusMi}
          onChange={(e) => setBookingArea("radiusMi", e.target.value)}
          style={INPUT}
        />
      </div>

      <div className="field" style={{ marginBottom: "0" }}>
        <label>Weekday hours</label>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <label className="switch" style={{ flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={wdWorking}
              onChange={(e) => {
                if (e.target.checked) { setBookingHours("wdOpen", 8); setBookingHours("wdClose", 17); }
                else { setBookingHours("wdOpen", 0); setBookingHours("wdClose", 0); }
              }}
            />
            <i />
          </label>
          {wdWorking ? (
            <>
              <HourSelect value={wdOpen} min={0} max={23} onChange={(h) => {
                setBookingHours("wdOpen", h);
                if (h >= wdClose) setBookingHours("wdClose", Math.min(h + 1, 24));
              }} />
              <span className="muted">to</span>
              <HourSelect value={wdClose} min={wdOpen + 1} max={24} onChange={(h) => setBookingHours("wdClose", h)} />
            </>
          ) : (
            <span className="muted" style={{ fontSize: "var(--type-base)" }}>Closed</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

// ── Connect your phone (forward-your-line — the app can't sense carrier forwarding) ──

export function ConnectPhoneModal({
  open,
  onClose,
  twilioNumber,
  onAck,
}: {
  open: boolean;
  onClose: () => void;
  twilioNumber: string | null;
  onAck: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth={480}>
      <h3 style={{ margin: "0 0 var(--space-1)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        Connect your phone
      </h3>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>
        Forward your business line to your Mallet number — the AI answers every call,
        day or night. Your existing number stays yours; nothing to port.
      </p>

      <div style={{
        border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "var(--space-4) var(--space-4)",
        marginBottom: "var(--space-4)", background: "var(--card)",
      }}>
        <div className="muted" style={{ fontSize: "var(--type-xs)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "var(--space-1)" }}>
          Your Mallet number
        </div>
        <div style={{ fontSize: "var(--type-xl)", fontWeight: 800, letterSpacing: "-.01em" }}>
          {twilioNumber ?? "Being provisioned — we'll email it shortly"}
        </div>
      </div>

      <ol style={{ margin: "0 0 var(--space-5)", paddingLeft: "var(--space-5)", fontSize: "var(--type-base)", lineHeight: 1.7, color: "var(--ink-2)" }}>
        <li>Open your phone carrier&apos;s call-forwarding settings.</li>
        <li>Forward calls {twilioNumber ? `to ${twilioNumber}` : "to your Mallet number"} — all calls, or just when unanswered.</li>
        <li>Come back and make a test call.</li>
      </ol>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button className="btn ghost" onClick={onClose}>Later</button>
        <button className="btn primary" onClick={() => { onAck(); onClose(); }}>
          I&apos;ve forwarded my number
        </button>
      </div>
    </Modal>
  );
}

// ── Make a test call (the AHA — completes on its own when a real call lands) ──

export function TestCallModal({
  open,
  onClose,
  twilioNumber,
  done,
}: {
  open: boolean;
  onClose: () => void;
  twilioNumber: string | null;
  done: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth={480}>
      <h3 style={{ margin: "0 0 var(--space-1)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        Make a test call
      </h3>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>
        Call your number and act like a customer — describe a job and ask to book.
        Watch it land in your pipeline.
      </p>

      <div style={{
        border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "var(--space-4) var(--space-4)",
        marginBottom: "var(--space-4)", textAlign: "center", background: "var(--card)",
      }}>
        <div style={{ fontSize: "var(--type-2xl)", fontWeight: 800, letterSpacing: "-.01em" }}>
          {twilioNumber ?? "Your Mallet number is on its way"}
        </div>
      </div>

      {done ? (
        <div style={{
          borderRadius: "var(--radius)", padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)",
          background: "var(--green-50, #edf7ee)", border: "1px solid var(--green-600, #2e7d32)",
          fontSize: "var(--type-base)", fontWeight: 700, color: "var(--green-900, #1b5e20)",
        }}>
          ✓ Your AI Front Desk answered a call — you&apos;re live.
        </div>
      ) : (
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-3)", margin: "0 0 var(--space-4)" }}>
          This step completes on its own once your first call comes through.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

// ── Grow-tier: a preview + route (rich surfaces already live in Settings) ──

export function GrowStepModal({
  open,
  onClose,
  title,
  blurb,
  points,
  href,
  cta,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  blurb: string;
  points: string[];
  href: string;
  cta: string;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth={460}>
      <h3 style={{ margin: "0 0 var(--space-1)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>{title}</h3>
      <p className="muted" style={{ fontSize: "var(--type-base)", margin: "0 0 var(--space-4)" }}>{blurb}</p>
      <ul style={{ margin: "0 0 var(--space-5)", paddingLeft: "var(--space-5)", fontSize: "var(--type-base)", lineHeight: 1.7, color: "var(--ink-2)" }}>
        {points.map((p) => <li key={p}>{p}</li>)}
      </ul>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button className="btn ghost" onClick={onClose}>Later</button>
        <Link href={href} className="btn primary" style={{ textDecoration: "none" }}>{cta}</Link>
      </div>
    </Modal>
  );
}
