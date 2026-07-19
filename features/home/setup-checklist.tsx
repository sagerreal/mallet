"use client";

// Home's onboarding card — a two-tier, fully-derived setup checklist. "Get live" is the required
// path to the first AI-answered call (the aha); "Make it better" is everything crucial-but-deferred.
// Every step completes IN A MODAL from here (no navigating to Settings for the required path).
// The card retires once both tiers are done; dismissible early via localStorage.

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { useMe } from "@/features/identity/hooks";
import {
  deriveSetupSteps,
  stepsByTier,
  tierComplete,
  setupComplete,
  doneCount,
  type SetupStep,
  type SetupStepKey,
} from "./setup";
import { StarterPlaybookModal } from "@/app/(office)/settings/starter-playbook-modal";
import { playbookFor } from "@/app/(office)/settings/trade-playbooks";
import { OfficeHoursModal, ConnectPhoneModal, TestCallModal, GrowStepModal } from "./setup-modals";

const DISMISS_KEY = "mallet.setupChecklist.dismissed";
const PHONE_ACK_KEY = "mallet.setupChecklist.phoneAcked";

export function SetupChecklist() {
  const services = useAppStore((s) => s.booking.services);
  const originAddress = useAppStore((s) => s.booking.area.originAddress);
  const leads = useAppStore((s) => s.leads);
  const pricebook = useAppStore((s) => s.services);
  const seedBookingServices = useAppStore((s) => s.seedBookingServices);
  const setTrade = useAppStore((s) => s.setTrade);

  const me = useMe();
  const members = api.v1.identity.members.useQuery(undefined, { refetchOnWindowFocus: false });
  const inbound = api.v1.inbound.list.useQuery(undefined, { refetchOnWindowFocus: false });

  // Client-only flags (identical server + first-client render → no hydration mismatch, then reveal).
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [phoneAcked, setPhoneAcked] = useState(false);
  const [openStep, setOpenStep] = useState<SetupStepKey | null>(null);
  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    setPhoneAcked(window.localStorage.getItem(PHONE_ACK_KEY) === "1");
    setReady(true);
  }, []);

  const endpoints = inbound.data ?? [];
  const steps = deriveSetupSteps({
    servicesCount: services.length,
    originAddress,
    phoneAcked,
    hasAiLead: leads.some((l) => l.source === "AI Front Desk"),
    pricebookCount: pricebook.length,
    hasMarketplace: endpoints.some((e) => e.channel === "angi" || e.channel === "thumbtack"),
    hasWebsiteForm: endpoints.some((e) => e.channel === "form"),
    hasFieldCrew: (members.data?.items ?? []).some((m) => m.isFieldCrew),
  });

  if (!ready || dismissed || setupComplete(steps)) return null;

  const live = stepsByTier(steps, "live");
  const grow = stepsByTier(steps, "grow");
  const liveDone = tierComplete(steps, "live");
  const twilioNumber = me.data?.twilioNumber ?? null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  function ackPhone() {
    window.localStorage.setItem(PHONE_ACK_KEY, "1");
    setPhoneAcked(true);
  }

  function seedTrade(tradeKey: string) {
    const pb = playbookFor(tradeKey);
    if (!pb) return;
    seedBookingServices(pb.services);
    if (tradeKey !== "other") setTrade(pb.label);
  }

  return (
    <div className="card" style={{ position: "relative" }}>
      <button className="x" aria-label="Dismiss setup" onClick={dismiss}>✕</button>

      <h3 style={{ marginBottom: 2 }}>
        {liveDone ? "Your AI Front Desk is live 🎉" : "Set up your AI Front Desk"}
        <span className="muted" style={{ fontWeight: 600, fontSize: 12.5, marginLeft: 8 }}>
          {doneCount(steps)} of {steps.length}
        </span>
      </h3>

      {/* Tier 1 — required path to the first call */}
      {!liveDone && (
        <>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", margin: "12px 0 2px" }}>
            Get live
          </div>
          {live.map((s, i) => (
            <StepRow key={s.key} step={s} last={i === live.length - 1} onOpen={() => setOpenStep(s.key)} />
          ))}
        </>
      )}

      {liveDone && (
        <div style={{
          borderRadius: 12, padding: "12px 14px", margin: "12px 0 4px",
          background: "var(--green-50, #edf7ee)", border: "1px solid var(--green-600, #2e7d32)",
          fontSize: 13, fontWeight: 700, color: "var(--green-900, #1b5e20)",
        }}>
          ✓ It answered a real call and booked a job. Now make it even better ↓
        </div>
      )}

      {/* Tier 2 — deferred "make it better" */}
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", margin: "14px 0 2px" }}>
        Make it even better
      </div>
      {grow.map((s, i) => (
        <StepRow key={s.key} step={s} last={i === grow.length - 1} onOpen={() => setOpenStep(s.key)} />
      ))}

      {/* Modals */}
      <StarterPlaybookModal open={openStep === "services"} onClose={() => setOpenStep(null)} onSeed={seedTrade} />
      <OfficeHoursModal open={openStep === "office"} onClose={() => setOpenStep(null)} />
      <ConnectPhoneModal open={openStep === "phone"} onClose={() => setOpenStep(null)} twilioNumber={twilioNumber} onAck={ackPhone} />
      <TestCallModal open={openStep === "test-call"} onClose={() => setOpenStep(null)} twilioNumber={twilioNumber} done={steps.find((s) => s.key === "test-call")?.done ?? false} />
      <GrowStepModal
        open={openStep === "pricebook"} onClose={() => setOpenStep(null)}
        title="Build your pricebook" blurb="Your prices, so visits turn into quotes in seconds."
        points={["List your common services and their prices", "The AI and your estimator quote straight from it", "Good/Better/Best options supported"]}
        href="/pricebook" cta="Open pricebook"
      />
      <GrowStepModal
        open={openStep === "marketplaces"} onClose={() => setOpenStep(null)}
        title="Connect lead marketplaces" blurb="Pull Angi & Thumbtack leads straight into your pipeline."
        points={["Mint a webhook link for each marketplace", "New leads land automatically, no copy-paste", "Same pipeline as your calls and website"]}
        href="/settings?tab=sources" cta="Connect marketplaces"
      />
      <GrowStepModal
        open={openStep === "website-form"} onClose={() => setOpenStep(null)}
        title="Add your website form" blurb="Turn site visitors into leads you can quote."
        points={["Get a shareable link or one-line embed", "Every submission becomes a lead", "Works on any website"]}
        href="/settings?tab=sources" cta="Set up the form"
      />
      <GrowStepModal
        open={openStep === "crew"} onClose={() => setOpenStep(null)}
        title="Add your field crew" blurb="So the AI books the nearest available tech."
        points={["Mark who's out in the field", "Set each crew's working hours", "Jobs route by proximity + availability"]}
        href="/settings?tab=workspace" cta="Add crew"
      />
    </div>
  );
}

function StepRow({ step, last, onOpen }: { step: SetupStep; last: boolean; onOpen: () => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "11px 0",
        borderBottom: last ? "none" : "1px solid var(--line-2, var(--line))",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 800,
          border: step.done ? "none" : "1.6px solid var(--line)",
          background: step.done ? "var(--green-600, #2e7d32)" : "transparent",
          color: step.done ? "var(--card, #fff)" : "transparent",
        }}
      >
        ✓
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600, fontSize: 13.5,
          color: step.done ? "var(--ink-3)" : "var(--ink)",
          textDecoration: step.done ? "line-through" : "none",
        }}>
          {step.label}
        </div>
        {!step.done && (
          <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>{step.blurb}</div>
        )}
      </div>
      {!step.done && (
        <button className="btn sm ghost" onClick={onOpen} style={{ flexShrink: 0 }}>Set up</button>
      )}
    </div>
  );
}
