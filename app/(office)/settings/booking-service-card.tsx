"use client";

import { useState } from "react";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import { Segmented } from "./segmented";

// The service list row + in-place editor for Settings → Booking → Services & routing.
// Styling rides the app's design system (prototype.css): `.field` for labeled inputs,
// `.seg` for the lane toggle, `.btn sm ghost` for the optional-field add buttons —
// the same visual language as the composer (the house reference for "good UI").

// ---- Lane copy ------------------------------------------------------------------

const LANE_LABEL: Record<BookingService["lane"], string> = {
  repair: "Repair",
  estimate: "Estimate",
  flat: "Flat",
};

function laneChipLabel(service: BookingService): string {
  if (service.lane === "flat" && service.price != null) {
    return `Flat $${service.price}`;
  }
  return LANE_LABEL[service.lane];
}

const LANE_OPTIONS = [
  { value: "repair" as const, label: "Repair" },
  { value: "estimate" as const, label: "Estimate" },
  { value: "flat" as const, label: "Flat price" },
] as const;

// Compact field sizing for this tab — overrides the roomier global .field input so booking
// fields read as crisp single-line inputs, not paragraph boxes. Width-capped for the same reason.
export const COMPACT_INPUT: React.CSSProperties = {
  fontSize: 13.5,
  padding: "8px 10px",
  borderRadius: 8,
};
export const FIELD_MAX_WIDTH = 560;

// Small status chip on the collapsed row (lane / emergency / ballpark markers).
const CHIP_STYLE: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: "3px 10px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  color: "var(--ink-2)",
  background: "var(--card)",
  whiteSpace: "nowrap",
};

// ---- Props ------------------------------------------------------------------------

export interface ServiceRowProps {
  service: BookingService;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  updateBookingService: (index: number, field: keyof BookingService, value: string) => void;
  onRemove: () => void;
  isLast: boolean;
}

// ---- Collapsed row -----------------------------------------------------------------

function CollapsedRow({
  service,
  isExpanded,
  onToggle,
  isLast,
}: Pick<ServiceRowProps, "service" | "isExpanded" | "onToggle" | "isLast">) {
  return (
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "13px 14px",
        background: "none",
        border: "none",
        borderBottom: isLast && !isExpanded ? "none" : "1px solid var(--line-2, var(--line))",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        minHeight: 48,
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-3)", flexShrink: 0 }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span
        style={{
          fontWeight: 700,
          fontSize: 14,
          flex: 1,
          color: "var(--ink)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          letterSpacing: "-.01em",
        }}
      >
        {service.name || "Untitled service"}
      </span>
      {(service.emergencyTriggers ?? "").length > 0 && (
        <span style={CHIP_STYLE}>⚡ emergency</span>
      )}
      {(service.ballpark ?? "").length > 0 && <span style={CHIP_STYLE}>~ ballpark</span>}
      <span style={CHIP_STYLE}>{laneChipLabel(service)}</span>
    </button>
  );
}

// ---- Expanded editor -----------------------------------------------------------------

function ExpandedEditor({
  service,
  index,
  updateBookingService,
  onRemove,
  isLast,
}: Pick<ServiceRowProps, "service" | "index" | "updateBookingService" | "onRemove" | "isLast">) {
  const [lane, setLane] = useState<BookingService["lane"]>(service.lane);
  const [showEmergency, setShowEmergency] = useState(
    (service.emergencyTriggers ?? "").length > 0,
  );
  const [showBallpark, setShowBallpark] = useState((service.ballpark ?? "").length > 0);

  function handleLaneChange(next: BookingService["lane"]) {
    setLane(next);
    updateBookingService(index, "lane", next);
  }

  return (
    <div
      style={{
        padding: "16px 14px 14px 36px",
        borderBottom: isLast ? "none" : "1px solid var(--line-2, var(--line))",
      }}
    >
      <div style={{ maxWidth: FIELD_MAX_WIDTH }}>
      <div className="field">
        <label>Service name</label>
        <input
          type="text"
          defaultValue={service.name}
          onChange={(e) => updateBookingService(index, "name", e.target.value)}
          style={COMPACT_INPUT}
        />
      </div>

      <div className="field">
        <label>How it&apos;s priced</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Segmented value={lane} onChange={handleLaneChange} options={LANE_OPTIONS} />
          {lane === "flat" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>$</span>
              <input
                type="number"
                min={0}
                defaultValue={service.price ?? 0}
                onChange={(e) => updateBookingService(index, "price", e.target.value)}
                style={{ ...COMPACT_INPUT, width: 110 }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <label>Job description</label>
        <input
          type="text"
          defaultValue={service.triggers}
          onChange={(e) => updateBookingService(index, "triggers", e.target.value)}
          placeholder="e.g. leaking, no hot water, clog"
          style={COMPACT_INPUT}
        />
      </div>

      {showEmergency && (
        <div className="field">
          <label>Emergency words</label>
          <input
            type="text"
            defaultValue={service.emergencyTriggers ?? ""}
            onChange={(e) => updateBookingService(index, "emergencyTriggers", e.target.value)}
            placeholder="e.g. burst pipe, no heat, flooding"
            style={COMPACT_INPUT}
          />
        </div>
      )}

      {showBallpark && (
        <div className="field">
          <label>Ballpark range</label>
          <input
            type="text"
            defaultValue={service.ballpark ?? ""}
            onChange={(e) => updateBookingService(index, "ballpark", e.target.value)}
            placeholder="e.g. $150–$300, said once — exact price after the visit"
            style={COMPACT_INPUT}
          />
        </div>
      )}

      </div>

      {/* Footer: optional-field add buttons left, destructive action right — one calm row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 2,
          maxWidth: FIELD_MAX_WIDTH,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!showEmergency && (
            <button type="button" className="btn sm ghost" onClick={() => setShowEmergency(true)}>
              + Emergency words
            </button>
          )}
          {!showBallpark && (
            <button type="button" className="btn sm ghost" onClick={() => setShowBallpark(true)}>
              + Ballpark range
            </button>
          )}
        </div>
        <button
          type="button"
          className="lineedit-tool"
          onClick={onRemove}
          style={{ color: "var(--red, #B3261E)" }}
        >
          Remove service
        </button>
      </div>
    </div>
  );
}

// ---- ServiceRow (collapsed + expanded) -------------------------------------------------

export function ServiceRow(props: ServiceRowProps) {
  const { service, index, isExpanded, onToggle, updateBookingService, onRemove, isLast } = props;
  return (
    <div>
      <CollapsedRow
        service={service}
        isExpanded={isExpanded}
        onToggle={onToggle}
        isLast={isLast && !isExpanded}
      />
      {isExpanded && (
        <ExpandedEditor
          service={service}
          index={index}
          updateBookingService={updateBookingService}
          onRemove={onRemove}
          isLast={isLast}
        />
      )}
    </div>
  );
}
