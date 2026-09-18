"use client";

/**
 * The estimate's masthead — its title, and the one line that says who it is for, what it is
 * called, and how long it stands.
 *
 * This IS the document's headline, so it is edited where it is read rather than in a form
 * above it. The customer sits in the same line for the same reason: "For Dana Whitfield ·
 * EST-1042 · Valid 30 days" is one sentence a person checks at a glance, and splitting it into
 * a labelled field and a separate heading made the office read two blocks to learn one thing.
 */

import { CustomerSelector } from "./customer-selector";
import type { ComposerState } from "./composer-state";
import type { Lead } from "@/lib/store/types";

export function EstimateHead({
  state,
  onUpdate,
  leads,
  lead,
  quoteNum,
  onNewCust,
  isAddingCust,
  onPreview,
  onSend,
  previewGateReason,
  sendGateReason,
  isSending,
  isSavingDraft,
  sendError,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leads: Lead[];
  /** The chosen customer, once there is one. */
  lead: Lead | null;
  /** The estimate's number once it has one. A quote that has never been saved has none. */
  quoteNum: string | null;
  onNewCust: () => void;
  isAddingCust: boolean;
  /** The top-right actions — the mock's "Preview customer copy" and "Send estimate". */
  onPreview: () => void;
  onSend: () => void;
  /** Why preview/send are unavailable, or null when they may run. Shared with the Send card. */
  previewGateReason: string | null;
  sendGateReason: string | null;
  isSending: boolean;
  /**
   * A Save draft is in flight. Both actions disable during it, exactly as the Send card's do —
   * otherwise this Send and that Save both call quoting.draft and persist TWO estimates for
   * one quote: a draft in the rail and a sent copy at the customer.
   */
  isSavingDraft: boolean;
  /** The last send/preview failure. Rendered HERE too — an error a scroll away is a silent no-op. */
  sendError: string | null;
}) {
  return (
    <div className="esthead">
      <div className="esthead-row">
        <input
          className="esthead-title"
          value={state.title}
          placeholder="Estimate title"
          aria-label="Estimate title"
          maxLength={200}
          onChange={(e) => onUpdate({ title: e.target.value })}
        />
        <div className="esthead-acts">
          <button
            type="button"
            className="btn sm"
            disabled={previewGateReason !== null || isSending || isSavingDraft}
            title={previewGateReason ?? "Open the page the customer will see"}
            onClick={onPreview}
          >
            Preview customer copy
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={sendGateReason !== null || isSending || isSavingDraft}
            title={sendGateReason ?? undefined}
            onClick={onSend}
          >
            {isSending ? "Sending…" : "Send estimate"}
          </button>
        </div>
      </div>
      <div className="esthead-meta">
        <span className="esthead-for">For</span>
        {lead ? (
          <button
            type="button"
            className="esthead-cust"
            title="Change the customer"
            onClick={() => onUpdate({ leadId: null, custQuery: "" })}
          >
            {lead.name}
          </button>
        ) : (
          <CustomerSelector
            state={state}
            onUpdate={onUpdate}
            leads={leads}
            onNewCust={onNewCust}
            isAddingCust={isAddingCust}
            inline
          />
        )}
        <span className="esthead-dot" aria-hidden="true">
          ·
        </span>
        {/* A quote that has never been saved has no number yet, and inventing one would be a
            number the office could quote to a customer and never find again. */}
        {quoteNum ? <span>{quoteNum}</span> : <span className="esthead-draft">Draft</span>}
        <span className="esthead-dot" aria-hidden="true">
          ·
        </span>
        <label className="esthead-valid">
          Valid
          <input
            type="number"
            min={1}
            max={365}
            value={state.validDays}
            aria-label="Valid for, days"
            onChange={(e) => {
              const days = Math.round(Number(e.target.value));
              // A quote that stands for zero days is not a quote. Out-of-range input is
              // ignored rather than clamped mid-keystroke, which fights the typist.
              if (Number.isFinite(days) && days > 0 && days <= 365) onUpdate({ validDays: days });
            }}
          />
          days
        </label>
      </div>
      {sendError && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {sendError}
        </p>
      )}
    </div>
  );
}
