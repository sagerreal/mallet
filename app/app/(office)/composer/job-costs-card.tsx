"use client";

/**
 * Other job costs — what this job costs beyond the quote's own lines.
 *
 * A permit, a dumpster, a sub's day, or a purchase order already placed against the job. None
 * of it touches the customer's price. It exists so the margin the estimator reads is the real
 * one: a $4,495 repaint with a $400 dumpster behind it is not a $4,495 repaint.
 *
 * A purchase order becomes a job cost when it is ADDED ON THE JOB — so the picker offers the
 * orders on this quote's job and nothing else. A quote with no walkthrough behind it has no
 * orders to pull, and says so rather than showing an empty list of somebody else's spending.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { fmt$ } from "@/lib/format";
import { DraftNumberInput } from "@/components/shared/draft-number-input";
import {
  jobCostTotal,
  pulledOrderIds,
  realJobCosts,
  type ComposerJobCost,
  type ComposerState,
} from "./composer-state";

export function JobCostsCard({
  costs,
  jobId,
  onChange,
}: {
  costs: ComposerJobCost[];
  /** The scope-visit job this quote prices. Null when the quote came from no walkthrough. */
  jobId: string | null;
  onChange: (next: ComposerJobCost[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // The whole book of orders; the ones on THIS job are the only ones offered. Loaded only while
  // the picker is open — an estimator who never pulls an order never pays for the query.
  const ordersQuery = api.v1.purchasing.list.useQuery(undefined, {
    enabled: pickerOpen && jobId !== null,
    refetchOnWindowFocus: false,
  });
  const pulled = pulledOrderIds(costs);
  const onThisJob = (ordersQuery.data?.items ?? []).filter(
    (po) => po.jobId === jobId && po.status === "ordered",
  );

  const patch = (id: string, next: Partial<ComposerJobCost>) =>
    onChange(costs.map((cost) => (cost.id === id ? { ...cost, ...next } : cost)));

  return (
    <div className="jobcosts">
      {costs.map((cost, i) =>
        cost.poId ? (
          <div className="jobcost-row" key={cost.id}>
            <span className="jobcost-name">
              <span className="jobcost-tag">{cost.poNum ?? "PO"}</span>
              {cost.d}
            </span>
            <span className="jobcost-amt">{fmt$(cost.amt)}</span>
            <button
              type="button"
              className="lineedit-tool"
              aria-label={`Remove ${cost.d}`}
              onClick={() => onChange(costs.filter((c) => c.id !== cost.id))}
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="jobcost-row" key={cost.id}>
            <input
              value={cost.d}
              placeholder="Permit, dumpster, sub…"
              aria-label={`What the cost is, job cost ${i + 1}`}
              onChange={(e) => patch(cost.id, { d: e.target.value })}
            />
            <DraftNumberInput
              value={cost.amt}
              decimals={2}
              placeholder="0.00"
              aria-label={`Amount, job cost ${i + 1}`}
              style={{ width: 110, textAlign: "right" }}
              onCommit={(amt) => patch(cost.id, { amt })}
            />
            <button
              type="button"
              className="lineedit-tool"
              aria-label={`Remove job cost ${i + 1}`}
              onClick={() => onChange(costs.filter((c) => c.id !== cost.id))}
            >
              ✕
            </button>
          </div>
        ),
      )}

      {pickerOpen && (
        <div className="jobcost-picker">
          {jobId === null ? (
            <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
              This quote has no job behind it yet — an order becomes a job cost once it is on
              a job.
            </p>
          ) : ordersQuery.isPending ? (
            <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
              Loading orders…
            </p>
          ) : onThisJob.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
              No orders placed on this job yet.
            </p>
          ) : (
            onThisJob.map((po) => {
              const already = pulled.has(po.id);
              return (
                <button
                  key={po.id}
                  type="button"
                  className="jobcost-pick"
                  disabled={already}
                  onClick={() =>
                    onChange([
                      ...costs,
                      {
                        id: crypto.randomUUID(),
                        d: po.vendor,
                        amt: po.total.cents / 100,
                        poId: po.id,
                        ...(po.num ? { poNum: po.num } : {}),
                      },
                    ])
                  }
                >
                  <span className="jobcost-tag">{po.num ?? "—"}</span>
                  <span style={{ flex: 1, textAlign: "left" }}>{po.vendor}</span>
                  <span className="jobcost-amt">{already ? "Added" : fmt$(po.total.cents / 100)}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      <div className="lineedit-bar">
        <button
          type="button"
          className="lineedit-tool primary"
          onClick={() => onChange([...costs, { id: crypto.randomUUID(), d: "", amt: 0 }])}
        >
          + Add job cost
        </button>
        <button
          type="button"
          className="lineedit-tool"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((v) => !v)}
        >
          {pickerOpen ? "Close purchase orders" : "Pull from purchase orders"}
        </button>
        <span className="lineedit-spring" />
        <span className="jobcost-total">{fmt$(jobCostTotal(costs))}</span>
      </div>
    </div>
  );
}

/**
 * The card the composer mounts — a collapsed summary that opens in flow, the peer of Pricing.
 *
 * It sits beside Pricing rather than inside the costing view because a job cost is part of the
 * quote whatever the estimator is currently looking at, and a panel that appears only in one
 * view is one the office forgets exists.
 */
export function JobCostsPanel({
  state,
  onUpdate,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
}) {
  const real = realJobCosts(state.jobCosts);
  const summary =
    real.length === 0
      ? "None"
      : `${real.length} cost${real.length === 1 ? "" : "s"} · ${fmt$(jobCostTotal(real))}`;
  return (
    <div className="card">
      <div className={`reveal${state.jobCostsOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ jobCostsOpen: !state.jobCostsOpen })}
        >
          <span className="caret">▸</span> Other job costs
          <span className="reveal-sum">{summary}</span>
        </div>
        <div className="reveal-body">
          <JobCostsCard
            costs={state.jobCosts}
            jobId={state.jobId}
            onChange={(next) => onUpdate({ jobCosts: next })}
          />
        </div>
      </div>
    </div>
  );
}
