/**
 * features/counter/counter-panel.tsx
 * The in-flow menu above the bar: the session's request/artifact pairs, then —
 * while typing — person rows with situation + ranked verbs, or — when empty —
 * suggestions naming live records (the empty state is the to-do list, never a
 * blank face). Renders inside .cmd-menu; the bar's manila strip is the frame.
 */

"use client";

import { useEffect, useRef } from "react";
import type { CounterApi } from "./use-counter";
import type { Entry, Gate } from "./types";
import { AiApprovalBlock, AiResultBlock, AiThinkingBlock, AnswerBlock, ChoicesBlock, ConfirmBlock, GateBlock, MissBlock, QuoteCard } from "./artifacts";
import { RunBlock } from "./run-block";

function EntryView({ entry, api }: { entry: Entry; api: CounterApi }) {
  const a = entry.artifact;
  const h = {
    onSend: (gate: Gate, text: string) => api.sendGate(entry.id, gate, text),
    onUndo: () => api.undoEntry(entry.id),
    onOpen: api.openRef,
    onRun: api.runInput,
  };

  return (
    <div>
      <div className="ct-you">{entry.request}</div>
      {a.kind === "quote" && <QuoteCard artifact={a} h={h} />}
      {a.kind === "answer" && <AnswerBlock artifact={a} h={h} />}
      {a.kind === "run" && (
        <RunBlock
          artifact={a}
          h={{
            onSendAll: () => api.sendRun(entry.id),
            onUndo: () => api.undoEntry(entry.id),
            onOpen: api.openRef,
            onRun: api.runInput,
          }}
        />
      )}
      {a.kind === "gate-only" && (
        <div className="ct-block">
          {a.situation && <div className="ct-confirm ct-dim">{a.situation}</div>}
          <GateBlock gate={a.gate} sent={a.sent} onSend={h.onSend} onUndo={h.onUndo} />
        </div>
      )}
      {a.kind === "confirm" && <ConfirmBlock artifact={a} h={h} />}
      {a.kind === "choices" && <ChoicesBlock artifact={a} h={h} />}
      {a.kind === "miss" && <MissBlock artifact={a} h={h} />}
      {a.kind === "ai-result" && <AiResultBlock artifact={a} />}
      {a.kind === "ai-thinking" && <AiThinkingBlock />}
      {a.kind === "ai-approval" && (
        <AiApprovalBlock
          artifact={a}
          isWorking={api.isResuming}
          onApprove={(approvedIds, transcript) =>
            void api.resumeApproval(entry.id, transcript, approvedIds, [])
          }
          onDeny={(deniedIds, transcript) =>
            void api.resumeApproval(entry.id, transcript, [], deniedIds)
          }
        />
      )}
    </div>
  );
}

export function CounterPanel({ api }: { api: CounterApi }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest thing in view as entries land and rows change.
  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [api.entries, api.rows.length]);

  const typing = api.rows.length > 0;
  const empty = api.entries.length === 0 && !typing;

  return (
    <div ref={scrollRef}>
      {api.entries.map((entry) => (
        <EntryView key={entry.id} entry={entry} api={api} />
      ))}

      {typing && (
        <div>
          {api.rows.map((row, i) => (
            <div className={`cmd-person${i === 0 ? " top" : ""}`} key={row.lead.id}>
              <div className="cmd-person-line">
                <b>{row.lead.name}</b>
                <span className="ct-dim"> — {row.situation}</span>
              </div>
              <div className="cmd-person-verbs">
                {row.verbs.map((v, vi) => (
                  <button
                    type="button"
                    key={v.label}
                    className={`cmd-verb${vi === 0 && i === 0 ? " primary" : ""}`}
                    onClick={() => api.runInput(v.input)}
                  >
                    {v.label}
                    {vi === 0 && i === 0 && <span className="cmd-tab">⇥</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {empty && (
        <div>
          <div className="cmd-hint">Say it like you would to a person — Artie runs it:</div>
          {api.suggestions.map((sg) => (
            <button
              type="button"
              className="cmd-opt ct-optbtn"
              key={sg.label}
              onClick={() => api.runInput(sg.input)}
            >
              {sg.label}
              {sg.stake && <span className="ct-dim">{sg.stake}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
