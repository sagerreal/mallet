"use client";

import { useState } from "react";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import { Segmented } from "./segmented";

// ---- Lane chip ----------------------------------------------------------------

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

const LANE_CAPTION: Record<BookingService["lane"], string> = {
  repair: "Tech diagnoses on site and gives the exact price there.",
  estimate: "Free visit to scope the job, then you send a quote.",
  flat: "Booked at the set price below.",
};

const LANE_OPTIONS = [
  { value: "repair" as const, label: "Repair" },
  { value: "estimate" as const, label: "Estimate" },
  { value: "flat" as const, label: "Flat price" },
] as const;

// ---- Styles -------------------------------------------------------------------

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
  color: "var(--ink-2, #585D66)",
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1.5px solid var(--line)",
  borderRadius: 7,
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 13,
  backgroundColor: "var(--card)",
  color: "var(--ink)",
};

const HINT_STYLE: React.CSSProperties = {
  fontSize: 12,
  marginTop: 4,
  color: "var(--ink-2, #77756e)",
};

const CHIP_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  color: "var(--ink-2, #585D66)",
  background: "transparent",
  whiteSpace: "nowrap",
};

const PILL_BTN_STYLE: React.CSSProperties = {
  border: "1.5px dashed var(--line)",
  borderRadius: 999,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--ink-2, #585D66)",
  background: "transparent",
  cursor: "pointer",
  fontFamily: "inherit",
};

// ---- Props --------------------------------------------------------------------

export interface ServiceRowProps {
  service: BookingService;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  updateBookingService: (index: number, field: keyof BookingService, value: string) => void;
  onRemove: () => void;
  isLast: boolean;
}

// ---- Collapsed row ------------------------------------------------------------

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
        gap: 8,
        width: "100%",
        padding: "10px 12px",
        background: "none",
        border: "none",
        borderBottom: isLast && !isExpanded ? "none" : "1px solid var(--line-2, var(--line))",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        minHeight: 44,
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-3, #9499A1)", flexShrink: 0 }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1, color: "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {service.name || "Untitled service"}
      </span>
      {/* Lane chip */}
      <span style={CHIP_STYLE}>{laneChipLabel(service)}</span>
      {/* Optional meta chips */}
      {(service.emergencyTriggers ?? "").length > 0 && (
        <span style={{ ...CHIP_STYLE, fontSize: 11 }}>⚡ emergency</span>
      )}
      {(service.ballpark ?? "").length > 0 && (
        <span style={{ ...CHIP_STYLE, fontSize: 11 }}>~ ballpark</span>
      )}
    </button>
  );
}

// ---- Expanded editor ----------------------------------------------------------

function ExpandedEditor({
  service,
  index,
  updateBookingService,
  onRemove,
  isLast,
}: Pick<ServiceRowProps, "service" | "index" | "updateBookingService" | "onRemove" | "isLast">) {
  const [lane, setLane] = useState<BookingService["lane"]>(service.lane);
  const [showEmergency, setShowEmergency] = useState(
    (service.emergencyTriggers ?? "").length > 0
  );
  const [showBallpark, setShowBallpark] = useState(
    (service.ballpark ?? "").length > 0
  );

  function handleLaneChange(next: BookingService["lane"]) {
    setLane(next);
    updateBookingService(index, "lane", next);
  }

  return (
    <div
      style={{
        padding: "4px 12px 14px 24px",
        borderBottom: isLast ? "none" : "1px solid var(--line-2, var(--line))",
      }}
    >
      {/* Service name */}
      <div style={{ marginBottom: 10 }}>
        <label style={LABEL_STYLE}>Service name</label>
        <input
          type="text"
          defaultValue={service.name}
          onChange={(e) => updateBookingService(index, "name", e.target.value)}
          style={{ ...INPUT_STYLE, fontWeight: 600 }}
        />
      </div>

      {/* How it's priced */}
      <div style={{ marginBottom: 10 }}>
        <label style={LABEL_STYLE}>How it&apos;s priced</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Segmented
            value={lane}
            onChange={handleLaneChange}
            options={LANE_OPTIONS}
          />
          {lane === "flat" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ ...LABEL_STYLE, marginBottom: 0 }}>$</label>
              <input
                type="number"
                min={0}
                defaultValue={service.price ?? 0}
                onChange={(e) => updateBookingService(index, "price", e.target.value)}
                style={{ ...INPUT_STYLE, width: 100 }}
              />
            </div>
          )}
        </div>
        <div style={HINT_STYLE}>{LANE_CAPTION[lane]}</div>
      </div>

      {/* Job description (was "Words callers say") */}
      <div style={{ marginBottom: 10 }}>
        <label style={LABEL_STYLE}>Job description</label>
        <input
          type="text"
          defaultValue={service.triggers}
          onChange={(e) => updateBookingService(index, "triggers", e.target.value)}
          placeholder="e.g. leaking, no hot water, clog"
          style={INPUT_STYLE}
        />
        <div style={HINT_STYLE}>
          How customers describe this job when they call — used to match the call to this service.
        </div>
      </div>

      {/* Optional: Emergency words */}
      {showEmergency && (
        <div style={{ marginBottom: 10 }}>
          <label style={LABEL_STYLE}>Emergency words</label>
          <input
            type="text"
            defaultValue={service.emergencyTriggers ?? ""}
            onChange={(e) => updateBookingService(index, "emergencyTriggers", e.target.value)}
            placeholder="e.g. burst pipe, no heat, flooding"
            style={INPUT_STYLE}
          />
          <div style={HINT_STYLE}>Booked same-day when a caller says these.</div>
        </div>
      )}

      {/* Optional: Ballpark range */}
      {showBallpark && (
        <div style={{ marginBottom: 10 }}>
          <label style={LABEL_STYLE}>Ballpark range</label>
          <input
            type="text"
            defaultValue={service.ballpark ?? ""}
            onChange={(e) => updateBookingService(index, "ballpark", e.target.value)}
            placeholder="e.g. $150–$300"
            style={INPUT_STYLE}
          />
          <div style={HINT_STYLE}>Said once on estimate calls — e.g. $150–$300.</div>
        </div>
      )}

      {/* Pill buttons for hidden optional fields */}
      {(!showEmergency || !showBallpark) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {!showEmergency && (
            <button
              type="button"
              onClick={() => setShowEmergency(true)}
              style={PILL_BTN_STYLE}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderStyle = "solid";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderStyle = "dashed";
              }}
            >
              + Emergency words
            </button>
          )}
          {!showBallpark && (
            <button
              type="button"
              onClick={() => setShowBallpark(true)}
              style={PILL_BTN_STYLE}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderStyle = "solid";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderStyle = "dashed";
              }}
            >
              + Ballpark range
            </button>
          )}
        </div>
      )}

      {/* Footer: Remove service */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button
          type="button"
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            padding: "2px 0",
            fontSize: 12,
            color: "var(--ink-3, #9499A1)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 500,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--red-700, #b42318)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-3, #9499A1)";
          }}
        >
          Remove service
        </button>
      </div>
    </div>
  );
}

// ---- ServiceRow (collapsed + expanded) ----------------------------------------

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
