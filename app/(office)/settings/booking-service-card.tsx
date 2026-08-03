"use client";

import { useState } from "react";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import { normCert } from "@mallet/shared/dispatch/skill-gate";
import { Segmented } from "./segmented";
import { COMPACT_INPUT, Field, useGroupLabel, useFieldId } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { useAppStore } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import type { ServiceLane } from "@mallet/settings";
import {
  LANE_OPTIONS,
  emergencyWordsApply,
  flatPriceMissing,
  laneChipLabel,
  laneConsequence,
  parseBallpark,
  formatBallpark,
  type BallparkRange,
} from "./booking-lanes";

// The service list row + in-place editor for Settings → Booking → Services & routing.
// Styling rides the app's design system (prototype.css): `.field` for labeled inputs,
// `.seg` for the lane toggle, `.btn sm ghost` for the optional-field add buttons —
// the same visual language as the composer (the house reference for "good UI").

// Lane copy (labels, the collapsed chip, and what the caller hears) lives in booking-lanes.ts —
// starter-playbook-modal and add-service-modal render the same three lanes and must not drift.

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
  updateBookingService: (index: number, field: keyof BookingService, value: string | string[] | boolean) => void;
}

function ServiceCertChipsEditor({ index, certs, updateBookingService }: ServiceCertChipsEditorProps) {
  const [draft, setDraft] = useState("");
  const certGroup = useGroupLabel();
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
      <label {...certGroup.labelProps}>Certifications required</label>
      <div
        {...certGroup.groupProps}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", marginBottom: certs.length > 0 ? 8 : 0 }}
      >
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
          aria-label="Add a certification"
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
  /** The org-wide service call fee, in dollars — rendered so a "Service call" lane can state the
   *  number the caller will actually hear instead of leaving it to a panel further down the page. */
  serviceFee: number;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  updateBookingService: (index: number, field: keyof BookingService, value: string | string[] | boolean) => void;
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
      {(service.requiredCerts ?? []).map((cert) => (
        <span key={cert} style={CHIP_STYLE}>{cert}</span>
      ))}
      {/* The lane chip carries the flat price itself ("$149 flat"), so there is no separate
          price chip to read as a second, unrelated fact. */}
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
  serviceFee,
}: Pick<ServiceRowProps, "service" | "index" | "updateBookingService" | "onRemove" | "isLast" | "serviceFee">) {
  const [lane, setLane] = useState<ServiceLane>(service.lane);
  const [feeApplies, setFeeApplies] = useState<boolean>(service.feeApplies ?? false);
  const [price, setPrice] = useState<string>(
    service.lane === "flat" && (service.price ?? 0) > 0 ? String(service.price) : "",
  );
  const [ballpark, setBallpark] = useState<BallparkRange>(parseBallpark(service.ballpark ?? ""));
  const [showEmergency, setShowEmergency] = useState(
    (service.emergencyTriggers ?? "").length > 0,
  );
  const [showBallpark, setShowBallpark] = useState((service.ballpark ?? "").length > 0);
  const [showCerts, setShowCerts] = useState((service.requiredCerts ?? []).length > 0);
  const laneGroup = useGroupLabel();
  const ballparkGroup = useGroupLabel();
  const pricebookLink = useFieldId();

  // The real pricebook catalog — the link options and the resolved display price.
  const pricebookServices = useAppStore((s) => s.services);
  const linkedService = service.pricebookServiceId
    ? pricebookServices.find((p) => p.id === service.pricebookServiceId) ?? null
    : null;

  const priceMissing = !linkedService && flatPriceMissing(lane, price);

  // The lane is now chosen DIRECTLY — it is no longer inferred from whether a price happens to be
  // filled in, so picking a lane can never quietly land you in a different one.
  function handleLaneChange(next: ServiceLane) {
    setLane(next);
    updateBookingService(index, "lane", next);
  }

  function handlePriceChange(v: string) {
    setPrice(v);
    updateBookingService(index, "price", v);
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
      <Field label="Service name">
        <input
          type="text"
          defaultValue={service.name}
          onChange={(e) => updateBookingService(index, "name", e.target.value)}
          style={COMPACT_INPUT}
        />
      </Field>

      <div className="field">
        {/* Segmented already renders the group; the visible label names it directly
            rather than a second group wrapping it, which would leave the inner one
            anonymous. Its hardcoded aria-label is gone — same string, said twice. */}
        <label {...laneGroup.labelProps}>Job type</label>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Segmented
            value={lane}
            onChange={handleLaneChange}
            options={LANE_OPTIONS}
            aria-labelledby={laneGroup.labelProps.id}
          />
          {lane === "estimate" && (
            <label className="colchk" style={{ marginTop: "var(--space-2)" }}>
              <input
                type="checkbox"
                checked={feeApplies}
                onChange={(e) => {
                  setFeeApplies(e.target.checked);
                  updateBookingService(index, "feeApplies", e.target.checked);
                }}
              />
              Visit fee applies — the tech prices it on site
            </label>
          )}
          {lane === "flat" && !linkedService && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={price}
                placeholder="149"
                aria-label="Flat price"
                aria-invalid={priceMissing || undefined}
                onChange={(e) => handlePriceChange(e.target.value)}
                style={{ ...COMPACT_INPUT, width: 140 }}
              />
            </div>
          )}
          {lane === "flat" && linkedService && (
            <span style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>
              {fmt$(linkedService.unitPrice)}
              <span className="muted" style={{ fontWeight: 400, fontSize: "var(--type-sm)" }}> · from your pricebook</span>
            </span>
          )}
        </div>
        {/* Link the spoken price to a pricebook entry — ONE source of truth for the number.
            Linked: the phone always speaks the pricebook's CURRENT price; the manual field
            above disappears (it would be a dead second copy). "— custom —" unlinks. */}
        {lane === "flat" && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <label {...pricebookLink.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)" }}>
              Price from pricebook
            </label>
            <SelectMenu
              value={service.pricebookServiceId ?? ""}
              onChange={(v) => updateBookingService(index, "pricebookServiceId", v)}
              options={[
                { value: "", label: "— custom price —" },
                ...pricebookServices.map((p) => ({ value: p.id, label: `${p.name} (${fmt$(p.unitPrice)})` })),
              ]}
              {...pricebookLink.controlProps}
              compact
            />
          </div>
        )}
        {/* What the CALLER hears. The old two-button control had nowhere to say this, which is why
            the service call fee read as if it came from nowhere. */}
        <p
          style={{
            marginTop: "var(--space-2)",
            marginBottom: 0,
            fontSize: "var(--type-sm)",
            color: priceMissing ? "var(--red, #B3261E)" : "var(--ink-2)",
          }}
        >
          {laneConsequence(lane, linkedService ? String(linkedService.unitPrice) : price, serviceFee, feeApplies)}
        </p>
      </div>

      <Field label="Job description">
        <input
          type="text"
          defaultValue={service.triggers}
          onChange={(e) => updateBookingService(index, "triggers", e.target.value)}
          placeholder="e.g. leaking, no hot water, clog"
          style={COMPACT_INPUT}
        />
      </Field>

      {emergencyWordsApply({ lane, feeApplies }) && showEmergency && (
        <Field label="Emergency words">
          <input
            type="text"
            defaultValue={service.emergencyTriggers ?? ""}
            onChange={(e) => updateBookingService(index, "emergencyTriggers", e.target.value)}
            placeholder="e.g. burst pipe, no heat, flooding"
            style={COMPACT_INPUT}
          />
        </Field>
      )}

      {lane === "estimate" && showBallpark && (
        <div className="field">
          {/* Two controls, so the label names the pair and each end names itself —
              a screen reader otherwise reads two anonymous number inputs. */}
          <label {...ballparkGroup.labelProps}>Ballpark range ($)</label>
          <div {...ballparkGroup.groupProps} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={ballpark.low}
              aria-label="Ballpark range from"
              placeholder="150"
              onChange={(e) => handleBallparkChange({ ...ballpark, low: e.target.value })}
              style={{ ...COMPACT_INPUT, width: 120 }}
            />
            <span className="muted">to</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={ballpark.high}
              aria-label="Ballpark range to"
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
          {emergencyWordsApply({ lane, feeApplies }) && !showEmergency && (
            <button type="button" className="btn sm ghost" onClick={() => setShowEmergency(true)}>
              + Emergency words
            </button>
          )}
          {lane === "estimate" && !showBallpark && (
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
  const { service, index, isExpanded, onToggle, updateBookingService, onRemove, isLast, serviceFee } = props;
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
          serviceFee={serviceFee}
        />
      )}
    </div>
  );
}
