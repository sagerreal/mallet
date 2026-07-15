"use client";
import { useState } from "react";
import type { BookingService } from "@/lib/store/slices/settings-slice";

interface BookingServiceCardProps {
  service: BookingService;
  index: number;
  updateBookingService: (index: number, field: keyof BookingService, value: string) => void;
  onRemove: () => void;
}

export function BookingServiceCard({ service, index, updateBookingService, onRemove }: BookingServiceCardProps) {
  // lane state: controlled so toggling shows/hides flat price field
  const [lane, setLane] = useState(service.lane);

  // Progressive disclosure: show emergency / ballpark fields once opened or if pre-filled
  const [showEmergency, setShowEmergency] = useState(
    (service.emergencyTriggers ?? "").length > 0
  );
  const [showBallpark, setShowBallpark] = useState(
    (service.ballpark ?? "").length > 0
  );

  const LABEL_STYLE: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    color: "var(--ink-2, #666)",
  };

  const INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1.5px solid var(--line)",
    borderRadius: 7,
    padding: "6px 8px",
    fontFamily: "inherit",
    fontSize: 13,
  };

  return (
    <div style={{
      border: "1px solid var(--line)",
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 10,
      background: "var(--card)",
    }}>
      {/* Row 1: name + remove button */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input
          type="text"
          defaultValue={service.name}
          onChange={(e) => updateBookingService(index, "name", e.target.value)}
          style={{
            flex: 1,
            fontWeight: 600,
            fontSize: 14,
            border: "1.5px solid var(--line)",
            borderRadius: 7,
            padding: "6px 8px",
            fontFamily: "inherit",
          }}
        />
        <button
          className="btn sm ghost"
          aria-label="Remove service"
          onClick={onRemove}
          style={{ flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {/* Row 2: How it's priced + flat price (conditional) */}
      <div style={{ display: "grid", gridTemplateColumns: lane === "flat" ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={LABEL_STYLE}>How it&apos;s priced</label>
          <select
            value={lane}
            onChange={(e) => {
              const next = e.target.value as BookingService["lane"];
              setLane(next);
              updateBookingService(index, "lane", next);
            }}
            style={{
              width: "100%",
              border: "1.5px solid var(--line)",
              borderRadius: 7,
              padding: "6px 8px",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            <option value="repair">Repair — tech prices on site</option>
            <option value="estimate">Estimate — free visit, then quote</option>
            <option value="flat">Flat price — book at a set price</option>
          </select>
        </div>
        {lane === "flat" && (
          <div>
            <label style={LABEL_STYLE}>Flat price ($)</label>
            <input
              type="number"
              min={0}
              defaultValue={service.price ?? 0}
              onChange={(e) => updateBookingService(index, "price", e.target.value)}
              style={INPUT_STYLE}
            />
          </div>
        )}
      </div>

      {/* Row 3: Words callers say (triggers) */}
      <div style={{ marginBottom: 10 }}>
        <label style={LABEL_STYLE}>Words callers say</label>
        <input
          type="text"
          defaultValue={service.triggers}
          onChange={(e) => updateBookingService(index, "triggers", e.target.value)}
          placeholder="e.g. leaking, no hot water, clog"
          style={INPUT_STYLE}
        />
        <div className="muted" style={{ fontSize: "11.5px", marginTop: 4 }}>
          Phrases that route a call to this service.
        </div>
      </div>

      {/* Row 4: Progressive disclosure for optional fields */}
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
          <div className="muted" style={{ fontSize: "11.5px", marginTop: 4 }}>
            Booked same-day when a caller says these.
          </div>
        </div>
      )}
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
          <div className="muted" style={{ fontSize: "11.5px", marginTop: 4 }}>
            Said once on estimate calls — e.g. $150–$300.
          </div>
        </div>
      )}

      {/* Quiet add row — only show when at least one optional field is hidden */}
      {(!showEmergency || !showBallpark) && (
        <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
          {!showEmergency && (
            <button
              type="button"
              onClick={() => setShowEmergency(true)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 12,
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              + Emergency words
            </button>
          )}
          {!showBallpark && (
            <button
              type="button"
              onClick={() => setShowBallpark(true)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 12,
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              + Ballpark range
            </button>
          )}
        </div>
      )}
    </div>
  );
}
