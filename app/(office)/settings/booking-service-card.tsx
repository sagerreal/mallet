"use client";

import { useState } from "react";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import { normCert } from "@mallet/shared/dispatch/skill-gate";
import { Segmented } from "./segmented";
import { COMPACT_INPUT } from "@/components/ui/input";
import {
  routeOf,
  laneFor,
  parseBallpark,
  formatBallpark,
  type BookingRoute,
  type BallparkRange,
} from "./booking-lanes";

// The service list row + in-place editor for Settings → Booking → Services & routing.
// Styling rides the app's design system (prototype.css): `.field` for labeled inputs,
// `.seg` for the lane toggle, `.btn sm ghost` for the optional-field add buttons —
// the same visual language as the composer (the house reference for "good UI").

// ---- Lane copy ------------------------------------------------------------------

// The OWNER-facing binary: a service either books a job right away or gets quoted first.
// Price is an attribute of a bookable service, not a third kind of service (storage still
// keeps the repair/estimate/flat lanes — see booking-lanes.ts for the mapping).
const ROUTE_OPTIONS = [
  { value: "book" as const, label: "Book it" },
  { value: "quote" as const, label: "Quote first" },
] as const;

function routeChipLabel(service: BookingService): string {
  return routeOf(service.lane) === "quote" ? "Quote first" : "Book it";
}

// Booking fields use the shared COMPACT_INPUT treatment (imported above) so they
// read as crisp single-line inputs, not the roomier global .field boxes. Width-capped.
export const FIELD_MAX_WIDTH = 560;

// Small status chip on the collapsed row (lane / emergency / ballpark markers).
const CHIP_STYLE: React.CSSProperties = {
  fontSize: "var(--type-sm)",
  fontWeight: 700,
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line)",
  color: "var(--ink-2)",
  background: "var(--card)",
  whiteSpace: "nowrap",
};

const CERT_MAX = 10;

// ---- Cert chips editor (Certifications required) ---------------------------------
// Mirrors the CertChipsEditor pattern from the Team section of settings/page.tsx.
// Calls updateBookingService(index, "requiredCerts", nextArray) on every add/remove.
// Empty array collapses to undefined (store handles this) to keep clean services clean.

interface ServiceCertChipsEditorProps {
  index: number;
  certs: string[];
  updateBookingService: (index: number, field: keyof BookingService, value: string | string[]) => void;
}

function ServiceCertChipsEditor({ index, certs, updateBookingService }: ServiceCertChipsEditorProps) {
  const [draft, setDraft] = useState("");
  const atCap = certs.length >= CERT_MAX;

  function handleAdd(): void {
    const trimmed = draft.trim();
    if (!trimmed || atCap) return;
    // Dedupe case-insensitively via normCert.
    if (certs.some((c) => normCert(c) === normCert(trimmed))) {
      setDraft("");
      return;
    }
    setDraft("");
    updateBookingService(index, "requiredCerts", [...certs, trimmed]);
  }

  function handleRemove(idx: number): void {
    updateBookingService(index, "requiredCerts", certs.filter((_, i) => i !== idx));
  }

  return (
    <div className="field">
      <label>Certifications required</label>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", marginBottom: certs.length > 0 ? 8 : 0 }}>
        {certs.map((cert, i) => (
          <span
            key={`${cert}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              fontSize: "var(--type-base)",
              fontWeight: 600,
              padding: "var(--space-1) var(--space-1) var(--space-1) var(--space-3)",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--line)",
              background: "var(--manila, var(--bg))",
              color: "var(--ink)",
              whiteSpace: "nowrap",
            }}
          >
            {cert}
            <button
              type="button"
              aria-label={`Remove ${cert}`}
              onClick={() => handleRemove(i)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-3)",
                fontSize: "var(--type-sm)",
                lineHeight: 1,
                padding: "var(--space-2xs) var(--space-1)",
                fontFamily: "inherit",
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <input
          type="text"
          value={draft}
          placeholder={atCap ? "10 max" : "e.g. Gas"}
          disabled={atCap}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          style={{
            flex: "0 0 160px",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-2)",
            fontFamily: "inherit",
            fontSize: "var(--type-base)",
            background: atCap ? "var(--bg)" : "var(--card)",
            ...COMPACT_INPUT,
          }}
        />
        <button
          className="btn sm ghost"
          type="button"
          disabled={atCap || !draft.trim()}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---- Props ------------------------------------------------------------------------

export interface ServiceRowProps {
  service: BookingService;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  updateBookingService: (index: number, field: keyof BookingService, value: string | string[]) => void;
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
        gap: "var(--space-3)",
        width: "100%",
        padding: "var(--space-3) var(--space-4)",
        background: "none",
        border: "none",
        borderBottom: isLast && !isExpanded ? "none" : "1px solid var(--line-2, var(--line))",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        minHeight: 48,
      }}
    >
      <span style={{ fontSize: "var(--type-sm)", color: "var(--ink-3)", flexShrink: 0 }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span
        style={{
          fontWeight: 700,
          fontSize: "var(--type-md)",
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
      {service.lane === "flat" && (service.price ?? 0) > 0 && (
        <span style={CHIP_STYLE}>{`$${service.price}`}</span>
      )}
      {(service.requiredCerts ?? []).map((cert) => (
        <span key={cert} style={CHIP_STYLE}>{cert}</span>
      ))}
      <span style={CHIP_STYLE}>{routeChipLabel(service)}</span>
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
  const [route, setRoute] = useState<BookingRoute>(routeOf(service.lane));
  const [price, setPrice] = useState<string>(
    service.lane === "flat" && (service.price ?? 0) > 0 ? String(service.price) : "",
  );
  const [ballpark, setBallpark] = useState<BallparkRange>(parseBallpark(service.ballpark ?? ""));
  const [showEmergency, setShowEmergency] = useState(
    (service.emergencyTriggers ?? "").length > 0,
  );
  const [showBallpark, setShowBallpark] = useState((service.ballpark ?? "").length > 0);
  const [showCerts, setShowCerts] = useState((service.requiredCerts ?? []).length > 0);

  // Route + price DERIVE the stored lane (book+price=flat, book alone=repair, quote=estimate).
  function handleRouteChange(next: BookingRoute) {
    setRoute(next);
    updateBookingService(index, "lane", laneFor(next, price));
  }

  function handlePriceChange(v: string) {
    setPrice(v);
    updateBookingService(index, "price", v);
    updateBookingService(index, "lane", laneFor(route, v));
  }

  function handleBallparkChange(next: BallparkRange) {
    setBallpark(next);
    updateBookingService(index, "ballpark", formatBallpark(next));
  }

  return (
    <div
      style={{
        padding: "var(--space-4) var(--space-4) var(--space-4) var(--space-10)",
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
        <label>Job type</label>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Segmented value={route} onChange={handleRouteChange} options={ROUTE_OPTIONS} aria-label="Job type" />
          {route === "book" && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>$</span>
              <input
                type="number"
                min={0}
                value={price}
                placeholder="priced on site"
                onChange={(e) => handlePriceChange(e.target.value)}
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
          defaultValue={service.triggers}
          onChange={(e) => updateBookingService(index, "triggers", e.target.value)}
          placeholder="e.g. leaking, no hot water, clog"
          style={COMPACT_INPUT}
        />
      </div>

      {route === "book" && showEmergency && (
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

      {route === "quote" && showBallpark && (
        <div className="field">
          <label>Ballpark range ($)</label>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <input
              type="number"
              min={0}
              value={ballpark.low}
              placeholder="150"
              onChange={(e) => handleBallparkChange({ ...ballpark, low: e.target.value })}
              style={{ ...COMPACT_INPUT, width: 120 }}
            />
            <span className="muted">to</span>
            <input
              type="number"
              min={0}
              value={ballpark.high}
              placeholder="300"
              onChange={(e) => handleBallparkChange({ ...ballpark, high: e.target.value })}
              style={{ ...COMPACT_INPUT, width: 120 }}
            />
          </div>
        </div>
      )}

      {/* Certifications feed crew dispatch when the job (booked now, or quoted
          then created later) gets scheduled — but most services don't need them,
          so the editor stages behind the add-button below. */}
      {showCerts && (
        <ServiceCertChipsEditor
          index={index}
          certs={service.requiredCerts ?? []}
          updateBookingService={updateBookingService}
        />
      )}

      </div>

      {/* Footer: optional-field add buttons left, destructive action right — one calm row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          marginTop: "var(--space-2xs)",
          maxWidth: FIELD_MAX_WIDTH,
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {route === "book" && !showEmergency && (
            <button type="button" className="btn sm ghost" onClick={() => setShowEmergency(true)}>
              + Emergency words
            </button>
          )}
          {route === "quote" && !showBallpark && (
            <button type="button" className="btn sm ghost" onClick={() => setShowBallpark(true)}>
              + Ballpark range
            </button>
          )}
          {!showCerts && (
            <button type="button" className="btn sm ghost" onClick={() => setShowCerts(true)}>
              + Certifications
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
