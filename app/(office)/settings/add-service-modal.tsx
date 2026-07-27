"use client";

// "Add service" modal for Settings → Booking → Services & routing. Collects the whole
// service in one shot (name · pricing lane · flat price · job description) using the app's
// Modal shell + .field system, so a new service lands complete instead of as a bare name row.

import { useState } from "react";
import { Modal } from "@/components/modals/modal";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import { Segmented } from "./segmented";
import { COMPACT_INPUT } from "@/components/ui/input";
import type { ServiceLane } from "@mallet/settings";
import { LANE_OPTIONS, flatPriceMissing } from "./booking-lanes";

export interface NewServiceInput {
  name: string;
  lane: BookingService["lane"];
  price: string;
  triggers: string;
}

export function AddServiceModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (svc: NewServiceInput) => void;
}) {
  const [name, setName] = useState("");
  const [lane, setLane] = useState<ServiceLane>("repair");
  const [price, setPrice] = useState("");
  const [triggers, setTriggers] = useState("");

  function reset() {
    setName("");
    setLane("repair");
    setPrice("");
    setTriggers("");
  }

  function handleAdd() {
    // A flat lane with no price would fall back to speaking the SERVICE FEE, a different number
    // than the owner means to charge — so it is refused here rather than saved quietly.
    if (!name.trim() || flatPriceMissing(lane, price)) return;
    onAdd({ name: name.trim(), lane, price, triggers });
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} maxWidth={480}>
      <h3 style={{ margin: "0 0 var(--space-4)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        Add service
      </h3>

      <div className="field">
        <label>Service name</label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="e.g. Tankless install"
          style={COMPACT_INPUT}
        />
      </div>

      <div className="field">
        <label>Job type</label>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Segmented value={lane} onChange={setLane} options={LANE_OPTIONS} aria-label="Job type" />
          {lane === "flat" && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>$</span>
              <input
                type="number"
                min={0}
                value={price}
                placeholder="149"
                aria-label="Flat price"
                onChange={(e) => setPrice(e.target.value)}
                style={{ ...COMPACT_INPUT, width: 140 }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <label>Job description</label>
        <input
          type="text"
          value={triggers}
          onChange={(e) => setTriggers(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="e.g. leaking, no hot water, clog"
          style={COMPACT_INPUT}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
        <button className="btn ghost" onClick={() => { reset(); onClose(); }}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()} onClick={handleAdd}>
          Add service
        </button>
      </div>
    </Modal>
  );
}
