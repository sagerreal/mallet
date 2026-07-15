"use client";

// Home's onboarding card: what's left to set up, derived from real state (never a manual
// check-off), each row deep-linking to the exact settings tab. Renders NOTHING once every
// step is done — Home goes back to being the handoff note. Dismissible for owners who want
// it gone early (localStorage; reappears never).

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { deriveSetupSteps, setupComplete } from "./setup";

const DISMISS_KEY = "mallet.setupChecklist.dismissed";

export function SetupChecklist() {
  const services = useAppStore((s) => s.booking.services);
  const originAddress = useAppStore((s) => s.booking.area.originAddress);
  const leads = useAppStore((s) => s.leads);
  const members = api.v1.identity.members.useQuery(undefined, { refetchOnWindowFocus: false });

  // Start hidden on BOTH server and first client render (identical markup → no hydration
  // mismatch), then reveal after mount unless the owner dismissed it before.
  const [dismissed, setDismissed] = useState<boolean>(true);
  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const steps = deriveSetupSteps({
    servicesCount: services.length,
    originAddress,
    hasFieldCrew: (members.data?.items ?? []).some((m) => m.isFieldCrew),
    hasAiLead: leads.some((l) => l.source === "AI Front Desk"),
  });

  if (dismissed || setupComplete(steps)) return null;

  const doneCount = steps.filter((s) => s.done).length;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="card" style={{ position: "relative" }}>
      <button className="x" aria-label="Dismiss setup checklist" onClick={dismiss}>✕</button>
      <h3 style={{ marginBottom: 4 }}>
        Set up your AI Front Desk
        <span className="muted" style={{ fontWeight: 600, fontSize: 12.5, marginLeft: 8 }}>
          {doneCount} of {steps.length} done
        </span>
      </h3>
      <div>
        {steps.map((s, i) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 0",
              borderBottom: i === steps.length - 1 ? "none" : "1px solid var(--line-2, var(--line))",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 800,
                border: s.done ? "none" : "1.6px solid var(--line)",
                background: s.done ? "var(--green-600, #2e7d32)" : "transparent",
                color: s.done ? "var(--card, #fff)" : "transparent",
              }}
            >
              ✓
            </span>
            <span
              style={{
                flex: 1,
                fontWeight: 600,
                fontSize: 13.5,
                color: s.done ? "var(--ink-3)" : "var(--ink)",
                textDecoration: s.done ? "line-through" : "none",
              }}
            >
              {s.label}
            </span>
            {!s.done && (
              <Link href={s.href} className="btn sm ghost" style={{ textDecoration: "none" }}>
                Set up
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
