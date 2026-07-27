"use client";

// Trade onboarding: pick your trade (10 ICP verticals + Other) → seed the booking playbook
// with that trade's starter services (names, routing, call-matching descriptions, emergency
// words). Appends with dedupe — never replaces what the owner already built.

import { useState } from "react";
import { Modal } from "@/components/modals/modal";
import { TRADE_PLAYBOOKS, playbookFor } from "./trade-playbooks";
import { laneChipLabel } from "./booking-lanes";

const CHIP: React.CSSProperties = {
  fontSize: "var(--type-sm)",
  fontWeight: 700,
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line)",
  color: "var(--ink-2)",
  background: "var(--card)",
  whiteSpace: "nowrap",
};

export function StarterPlaybookModal({
  open,
  onClose,
  onSeed,
}: {
  open: boolean;
  onClose: () => void;
  onSeed: (tradeKey: string) => void;
}) {
  const [tradeKey, setTradeKey] = useState<string>("plumbing");
  const playbook = playbookFor(tradeKey);

  function handleSeed() {
    if (!playbook) return;
    onSeed(tradeKey);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={520}>
      <h3 style={{ margin: "0 0 var(--space-4)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        Starter playbook
      </h3>

      <div className="field">
        <label>Your trade</label>
        <select className="tsel" value={tradeKey} onChange={(e) => setTradeKey(e.target.value)}>
          {TRADE_PLAYBOOKS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Preview: the ACTUAL services this seeds — content, not explainer text. */}
      {playbook && (
        <div
          style={{
            border: "1px solid var(--line-2, var(--line))",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-4)",
            overflow: "hidden",
          }}
        >
          {playbook.services.map((s, i) => (
            <div
              key={s.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-2) var(--space-3)",
                borderBottom: i === playbook.services.length - 1 ? "none" : "1px solid var(--line-2, var(--line))",
              }}
            >
              <span style={{ flex: 1, fontWeight: 600, fontSize: "var(--type-base)" }}>{s.name}</span>
              {(s.emergencyTriggers ?? "").length > 0 && <span style={CHIP}>⚡ emergency</span>}
              <span style={CHIP}>{laneChipLabel(s)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSeed}>
          Add {playbook?.services.length ?? 0} services
        </button>
      </div>
    </Modal>
  );
}
