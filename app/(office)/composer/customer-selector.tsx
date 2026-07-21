"use client";

/**
 * Customer selector — pick an existing customer or quick-add a new one by
 * name. Extracted from the composer page; behavior unchanged.
 */

import type { Lead } from "@/lib/store/types";
import type { ComposerState } from "./composer-state";

export function CustomerSelector({
  state,
  onUpdate,
  leads,
  onNewCust,
  isAddingCust,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leads: Lead[];
  onNewCust: () => void;
  isAddingCust: boolean;
}) {
  const lead: Lead | null =
    state.leadId != null
      ? (leads.find((l) => l.id === state.leadId) ?? null)
      : null;

  if (lead) {
    return (
      <div className="sub">
        For <b>{lead.name}</b>
        {lead.phone && lead.phone !== "—" ? " · " + lead.phone : ""}
        {lead.job ? " — " + lead.job : ""}{" "}
        <span
          className="linklike"
          style={{ marginLeft: "var(--space-2)" }}
          onClick={() => onUpdate({ leadId: null, custQuery: "" })}
        >
          change
        </span>
      </div>
    );
  }

  const q = (state.custQuery ?? "").trim().toLowerCase();
  const matches = q
    ? leads
        .filter(
          (x) =>
            !x.book &&
            x.stage !== "Lost" &&
            ((x.name ?? "") + " " + (x.job ?? ""))
              .toLowerCase()
              .includes(q)
        )
        .slice(0, 6)
    : [];

  return (
    <div style={{ margin: "var(--space-2) 0 var(--space-4)", maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: "var(--type-base)", marginBottom: "var(--space-2)" }}>
        Customer
      </div>
      <input
        type="text"
        value={state.custQuery}
        placeholder="Type a name — pick an existing customer or add a new one"
        onChange={(e) => onUpdate({ custQuery: e.target.value })}
        onKeyDown={(e) => {
          // Route Enter through the guarded handler so rapid keypresses can't
          // multi-fire the create (same guard as the click path).
          if (e.key === "Enter" && q) {
            e.preventDefault();
            onNewCust();
          }
        }}
        style={{
          width: "100%",
          border: "1.5px solid var(--line)",
          borderRadius: q ? "9px 9px 0 0" : 9,
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "inherit",
          fontSize: "var(--type-base)",
        }}
      />
      {q && (
        <div
          style={{
            border: "1.5px solid var(--line)",
            borderTop: "none",
            borderRadius: "0 0 9px 9px",
            overflow: "hidden",
          }}
        >
          {matches.map((x) => (
            <div
              key={x.id}
              className="cmp-opt"
              onClick={() => onUpdate({ leadId: x.id, custQuery: "" })}
            >
              <b>{x.name}</b>
              {x.job ? (
                <span className="muted"> — {x.job}</span>
              ) : null}
            </div>
          ))}
          <div
            className="cmp-opt cmp-add"
            onClick={isAddingCust ? undefined : onNewCust}
            style={isAddingCust ? { opacity: 0.5, pointerEvents: "none" } : undefined}
            aria-disabled={isAddingCust}
          >
            {isAddingCust
              ? <>Adding &quot;<b>{state.custQuery}</b>&quot;…</>
              : <>+ Add new customer: &quot;<b>{state.custQuery}</b>&quot;</>}
          </div>
        </div>
      )}
    </div>
  );
}
