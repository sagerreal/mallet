/**
 * features/counter/artifacts.tsx
 * What a completed input looks like: the record itself. A quote materializes as
 * the same table the Quotes page renders — committed to the store before the
 * first line draws — and the only thing that ever waits is the outbound text,
 * behind one amber Send. No chat bubbles, no prose about records.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { fmt$ } from "@/lib/format";
import { useAnimatedNumber } from "@/features/home/use-animated-number";
import { clockNow } from "@/features/home/send";
import type { AiPendingItem, Artifact, Gate, OpenRef, SentMark, Suggestion } from "./types";

interface Handlers {
  onSend: (gate: Gate, text: string) => void;
  onUndo: () => void;
  onOpen: (ref: OpenRef) => void;
  onRun: (input: string) => void;
}

// ---- the gate: ghost text → one amber Send → ledger line -------------------------

export function GateBlock({
  gate,
  sent,
  onSend,
  onUndo,
  extraAction,
}: {
  gate: Gate;
  sent?: SentMark;
  onSend: (gate: Gate, text: string) => void;
  onUndo: () => void;
  extraAction?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(gate.text);
  const first = gate.kind === "ok-item" ? gate.item.lead.name.split(" ")[0] : gate.leadFirst;

  if (sent) {
    const secs = Math.max(0, Math.ceil((sent.expiresAt - Date.now()) / 1000));
    return (
      <div className="ledgerrow">
        <b className="fig" style={{ whiteSpace: "nowrap" }}>{sent.when}</b>
        <span style={{ minWidth: 0 }}>
          {`✓ sent to ${first} — it's in the thread`}
          {secs > 0 && (
            <>
              <span className="ct-dim"> · </span>
              <button type="button" className="linklike" onClick={onUndo}>
                Undo · {secs}s
              </button>
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="ct-gate">
      <div className="ct-gate-to">to {first}</div>
      {editing ? (
        <textarea
          className="ct-ghost-edit"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`Message to ${first}`}
        />
      ) : (
        <div className="ct-ghost">{text}</div>
      )}
      <div className="ct-actions">
        <button className="btn sm approve" onClick={() => onSend(gate, text)}>
          Send
        </button>
        <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Change"}
        </button>
        {extraAction}
      </div>
    </div>
  );
}

// ---- the quote card: the record, filling itself in --------------------------------

function CountUpTotal({ total }: { total: number }) {
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(total), [total]);
  const shown = useAnimatedNumber(target, 700);
  return <b className="fig">${shown.toLocaleString("en-US")}</b>;
}

export function QuoteCard({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "quote" }>;
  h: Handlers;
}) {
  return (
    <div className="ct-block">
      <div className="ct-card">
        <div className="ct-card-head">
          <span className="ct-dim">{artifact.num}</span> · <b>{artifact.leadName}</b> ·{" "}
          {artifact.title.toLowerCase()}
        </div>
        {artifact.lines.map((l, i) => (
          <div className="ctl" key={i} style={{ animationDelay: `${180 + i * 160}ms` }}>
            <span className="ctl-d">{l.d}</span>
            <span className="ctl-q ct-dim">{l.q !== 1 ? `${l.q} × ${fmt$(l.r)}` : ""}</span>
            <span className="ctl-a fig">{fmt$(l.q * l.r)}</span>
          </div>
        ))}
        <div className="ctl ct-total" style={{ animationDelay: `${180 + artifact.lines.length * 160}ms` }}>
          <span className="ctl-d" />
          <span className="ctl-q ct-dim">total</span>
          <span className="ctl-a">
            <CountUpTotal total={artifact.total} />
          </span>
        </div>
        {artifact.sourced && (
          <div className="ct-sourced" style={{ animationDelay: `${340 + artifact.lines.length * 160}ms` }}>
            {artifact.sourced}
          </div>
        )}
        <div className="ct-stamp">
          {artifact.picked
            ? `picked up your draft ${artifact.num} and finished it. nothing sent.`
            : `in your Quotes now. nothing sent.`}
        </div>
      </div>
      <GateBlock
        gate={artifact.gate}
        sent={artifact.sent}
        onSend={h.onSend}
        onUndo={h.onUndo}
        extraAction={
          <button
            type="button"
            className="linklike"
            style={{ fontSize: 12.5 }}
            onClick={() => h.onOpen({ type: "est", id: artifact.estId, label: artifact.num })}
          >
            open the quote ›
          </button>
        }
      />
    </div>
  );
}

// ---- answers: ledger lines, every noun a link ---------------------------------------

export function AnswerBlock({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "answer" }>;
  h: Handlers;
}) {
  return (
    <div className="ct-block">
      {artifact.head && <div className="ct-head">{artifact.head}</div>}
      {artifact.rows.map((r, i) => (
        <div className="ledgerrow" key={i}>
          {r.fig && <b className="fig" style={{ whiteSpace: "nowrap" }}>{r.fig}</b>}
          <span style={{ minWidth: 0 }}>
            {r.text}
            {r.open && (
              <>
                <span className="ct-dim"> · </span>
                <button
                  type="button"
                  className="linklike"
                  style={{ fontSize: 12 }}
                  onClick={() => h.onOpen(r.open as OpenRef)}
                >
                  {r.open.label} ›
                </button>
              </>
            )}
          </span>
        </div>
      ))}
      {artifact.verb && (
        <button
          type="button"
          className="linklike ct-verb"
          onClick={() => h.onRun(artifact.verb?.input ?? "")}
        >
          {artifact.verb.label}
        </button>
      )}
    </div>
  );
}

// ---- confirmations, choices, misses ---------------------------------------------------

export function ConfirmBlock({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "confirm" }>;
  h: Handlers;
}) {
  return (
    <div className="ct-block">
      {artifact.lines.map((l, i) => (
        <div className="ct-confirm" key={i}>
          {i === 0 ? "✓ " : ""}
          {l}
          {i === 0 && artifact.open && (
            <>
              <span className="ct-dim"> · </span>
              <button
                type="button"
                className="linklike"
                style={{ fontSize: 12 }}
                onClick={() => h.onOpen(artifact.open as OpenRef)}
              >
                {artifact.open.label} ›
              </button>
            </>
          )}
        </div>
      ))}
      {artifact.gate && (
        <GateBlock gate={artifact.gate} sent={artifact.sent} onSend={h.onSend} onUndo={h.onUndo} />
      )}
    </div>
  );
}

export function ChoicesBlock({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "choices" }>;
  h: Handlers;
}) {
  return (
    <div className="ct-block">
      <div className="ct-confirm">{artifact.prompt}</div>
      {artifact.options.map((o) => (
        <button type="button" className="cmd-opt ct-optbtn" key={o.label} onClick={() => h.onRun(o.input)}>
          <b>{o.label}</b>
          <span className="ct-dim">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function MissBlock({
  artifact,
  h,
}: {
  artifact: Extract<Artifact, { kind: "miss" }>;
  h: Handlers;
}) {
  return (
    <div className="ct-block">
      <div className="ct-confirm">{artifact.text}</div>
      {artifact.suggestions.map((sg: Suggestion) => (
        <button type="button" className="cmd-opt ct-optbtn" key={sg.label} onClick={() => h.onRun(sg.input)}>
          {sg.label}
          {sg.stake && <span className="ct-dim">{sg.stake}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- AI agent result: a plain text answer from the LLM (completed status) ----------

export function AiResultBlock({
  artifact,
}: {
  artifact: Extract<Artifact, { kind: "ai-result" }>;
}) {
  return (
    <div className="ct-block">
      <div className="ct-confirm" style={{ whiteSpace: "pre-wrap" }}>{artifact.text}</div>
    </div>
  );
}

// ---- AI thinking placeholder: shown while the mutation is in flight ----------------

export function AiThinkingBlock() {
  return (
    <div className="ct-block">
      <div className="ct-confirm ct-dim" aria-live="polite" aria-label="Mallet is thinking">
        thinking…
      </div>
    </div>
  );
}

// ---- AI approval block ----------------------------------------------------------
// Single pending: a GateBlock-style card with the summary + Approve / Deny.
// Multiple pending: a RunBlock-style ticking receipt (rows land ~450 ms apart)
// with "Approve all N" + "look at each" + "Deny all".
// No Undo timer: agent writes are already persisted server-side; we settle to a
// "✓ done" ai-result instead of showing a fake rollback affordance.

const APPROVAL_TICK_MS = 450;

interface AiApprovalHandlers {
  onApproveAll: (pending: AiPendingItem[]) => void;
  onApproveOne: (item: AiPendingItem) => void;
  onDenyAll: (pending: AiPendingItem[]) => void;
  onDenyOne: (item: AiPendingItem) => void;
  isWorking: boolean;
}

function SingleApprovalCard({
  item,
  h,
}: {
  item: AiPendingItem;
  h: AiApprovalHandlers;
}) {
  return (
    <div className="ct-gate">
      <div className="ct-gate-to">proposed action</div>
      <div className="ct-ghost">{item.summary}</div>
      <div className="ct-actions">
        <button
          className="btn sm approve"
          onClick={() => h.onApproveOne(item)}
          disabled={h.isWorking}
          aria-busy={h.isWorking}
        >
          {h.isWorking ? "working…" : "Approve"}
        </button>
        <button
          className="btn sm ghost"
          onClick={() => h.onDenyOne(item)}
          disabled={h.isWorking}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function MultiApprovalReceipt({
  pending,
  h,
}: {
  pending: AiPendingItem[];
  h: AiApprovalHandlers;
}) {
  const [shown, setShown] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const stampsRef = useRef<string[]>([]);

  useEffect(() => {
    if (shown >= pending.length) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      while (stampsRef.current.length < pending.length) stampsRef.current.push(clockNow());
      setShown(pending.length);
      return;
    }
    const iv = setInterval(() => {
      setShown((n) => {
        if (n >= pending.length) return n;
        stampsRef.current.push(clockNow());
        return n + 1;
      });
    }, APPROVAL_TICK_MS);
    return () => clearInterval(iv);
  }, [shown, pending.length]);

  const done = shown >= pending.length;

  return (
    <div className="ct-block" aria-live="polite">
      <div className="ct-head">
        {pending.length} actions proposed — nothing runs until you approve
      </div>

      {pending.slice(0, shown).map((item, i) => (
        <div key={item.toolUseId} className="ct-runrow">
          <div className="ledgerrow" style={{ paddingBottom: 2 }}>
            <b className="fig" style={{ whiteSpace: "nowrap" }}>
              {stampsRef.current[i] ?? ""}
            </b>
            <span style={{ minWidth: 0 }}>⏳ {item.summary}</span>
          </div>
          {expanded && (
            <div className="ct-runsub ct-dim">{item.tool}</div>
          )}
        </div>
      ))}

      {done && (
        <div className="ct-runfoot">
          <div className="ct-actions">
            <button
              className="btn sm approve"
              onClick={() => h.onApproveAll(pending)}
              disabled={h.isWorking}
              aria-busy={h.isWorking}
            >
              {h.isWorking ? "working…" : `Approve all ${pending.length}`}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => setExpanded((v) => !v)}
              disabled={h.isWorking}
            >
              {expanded ? "fold up" : "look at each"}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => h.onDenyAll(pending)}
              disabled={h.isWorking}
            >
              Deny all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiApprovalBlock({
  artifact,
  onApprove,
  onDeny,
  isWorking,
}: {
  artifact: Extract<Artifact, { kind: "ai-approval" }>;
  /** Called with the toolUseIds to approve and the current transcript. */
  onApprove: (approvedIds: string[], transcript: string) => void;
  /** Called with the toolUseIds to deny and the current transcript. */
  onDeny: (deniedIds: string[], transcript: string) => void;
  isWorking: boolean;
}) {
  const { pending, transcript } = artifact;

  const h: AiApprovalHandlers = {
    isWorking,
    onApproveAll: (items) => onApprove(items.map((i) => i.toolUseId), transcript),
    onApproveOne: (item) => onApprove([item.toolUseId], transcript),
    onDenyAll: (items) => onDeny(items.map((i) => i.toolUseId), transcript),
    onDenyOne: (item) => onDeny([item.toolUseId], transcript),
  };

  return (
    <div className="ct-block">
      {artifact.assistantText && (
        <div className="ct-confirm ct-dim" style={{ marginBottom: 8 }}>
          {artifact.assistantText}
        </div>
      )}
      {pending.length === 1 && pending[0] ? (
        <SingleApprovalCard item={pending[0]} h={h} />
      ) : (
        <MultiApprovalReceipt pending={pending} h={h} />
      )}
    </div>
  );
}

export type { Handlers };
