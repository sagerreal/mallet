"use client";

// Trade onboarding: pick your trade (10 ICP verticals + Other) → seed the booking playbook
// with that trade's starter services (names, routing, call-matching descriptions, emergency
// words). Appends with dedupe — never replaces what the owner already built.

import { useState } from "react";
import { Modal } from "@/components/modals/modal";
import { TRADE_PLAYBOOKS, playbookFor } from "./trade-playbooks";
import { routeOf } from "./booking-lanes";

const CHIP: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: "3px 10px",
  borderRadius: 999,
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
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>
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
            borderRadius: 10,
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          {playbook.services.map((s, i) => (
            <div
              key={s.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderBottom: i === playbook.services.length - 1 ? "none" : "1px solid var(--line-2, var(--line))",
              }}
            >
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{s.name}</span>
              {(s.emergencyTriggers ?? "").length > 0 && <span style={CHIP}>⚡ emergency</span>}
              <span style={CHIP}>{routeOf(s.lane) === "quote" ? "Quote first" : "Book it"}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={handleSeed}>
          Add {playbook?.services.length ?? 0} services
        </button>
      </div>
    </Modal>
  );
}
