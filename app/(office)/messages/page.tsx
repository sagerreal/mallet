"use client";

/**
 * Messages page — pixel-faithful port of the prototype's vMessages() + aiPhone().
 * Uses SAMPLE_LEADS / SAMPLE_JOBS / SAMPLE_TECHS / TODAY_ISO from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype source: vMessages() lines 3740-3757, aiPhone() lines 3759-3787.
 */

import { useState } from "react";
import {
  SAMPLE_LEADS,
  SAMPLE_JOBS,
  SAMPLE_TECHS,
  TODAY_ISO,
  type SampleLead,
  type SampleTech,
} from "@/lib/prototype-sample";

// ---- helpers ---------------------------------------------------------------

function stub(action: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

function leadInitials(name: string): string {
  return (name ?? "?")
    .split(/\s+/)
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function lastMsg(l: SampleLead): string {
  const acts = (l.acts ?? []).filter((x) => x.type === "text");
  if (acts.length) {
    const last = acts[acts.length - 1];
    const t = last?.t ?? "";
    return t.length > 64 ? t.slice(0, 64) + "…" : t;
  }
  return l.last ?? "";
}

/** Threads for a tech: customers with visits this week + anyone with unread messages */
function techThreads(techId: number): SampleLead[] {
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(TODAY_ISO + "T12:00:00");
    // Monday of this week
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow + i);
    return d.toISOString().slice(0, 10);
  });

  const ids = new Set<number>();
  const out: SampleLead[] = [];

  // Customers with visits this week assigned to this tech
  SAMPLE_JOBS.filter((j) => !j.archived).forEach((j) => {
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && weekDays.includes(v.date ?? "")) {
        const lead = SAMPLE_LEADS.find((l) => l.id === j.leadId);
        if (lead && !ids.has(lead.id)) {
          ids.add(lead.id);
          out.push(lead);
        }
      }
    });
  });

  // Anyone who texted back (unread)
  SAMPLE_LEADS.forEach((l) => {
    if (l.unread && !ids.has(l.id)) {
      ids.add(l.id);
      out.push(l);
    }
  });

  // Unread first
  return out.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0));
}

// ============================================================================
// AI Phone mock (what a tech sees texting Mallet AI from their own phone)
// Prototype: aiPhone() lines 3759-3787
// ============================================================================

const AI_CONVO = [
  { who: "me" as const, t: "Heading to the Hernandez job" },
  { who: "them" as const, t: "👍 En route to Two toilets · Sofia Hernandez — 318 Sycamore Rd. I texted her your ETA." },
  { who: "me" as const, photo: true },
  { who: "me" as const, t: "all done — used 2 capacitors, 2.5 hrs on site" },
  {
    who: "them" as const,
    t: "✓ Logged to Two toilets — Hernandez:\n•  photo added to the job\n•  2.5 h on your timesheet\n•  2× capacitor added to materials\nReady to invoice. Reply UNDO to undo.",
  },
  { who: "me" as const, t: "wait — that was the Okafor AC job, not Hernandez" },
  {
    who: "them" as const,
    t: "No problem — moved it to AC tune-up · Rita Okafor and reverted Hernandez. Anything else?",
  },
];

interface AiPhoneProps {
  onBack: () => void;
}

function AiPhone({ onBack }: AiPhoneProps) {
  const [step, setStep] = useState(0);

  const show = step === 0 ? 2 : step === 1 ? 5 : 7;

  const chip =
    step === 0 ? (
      <div
        className="iph-chip"
        onClick={() => setStep((s) => Math.min(2, s + 1))}
      >
        📷 Send: &ldquo;all done — used 2 caps, 2.5 hrs&rdquo;
      </div>
    ) : step === 1 ? (
      <div
        className="iph-chip"
        onClick={() => setStep((s) => Math.min(2, s + 1))}
      >
        Send: &ldquo;that was the Okafor job, not Hernandez&rdquo;
      </div>
    ) : (
      <div className="iph-chip" onClick={() => setStep(0)}>
        ↻ Replay
      </div>
    );

  return (
    <>
      <h1>Messages</h1>
      <div className="sub">
        What your crew texts from their own phone — no app to open.
      </div>
      <div className="iph-wrap">
        <div className="iphone">
          <div className="iph-screen">
            {/* Status bar */}
            <div className="iph-status">
              <span>9:41</span>
              <span className="r">▪▪▪ 5G 100%</span>
            </div>
            {/* Nav */}
            <div className="iph-nav">
              <span
                className="bk"
                onClick={onBack}
                style={{ cursor: "pointer" }}
              >
                ‹
              </span>
              <span className="av">✦</span>
              <span className="nm">Mallet</span>
              <span className="sb">(925) 555-0100</span>
            </div>
            {/* Body */}
            <div className="iph-body">
              <div className="sms-day">Today 2:47 PM</div>
              {AI_CONVO.slice(0, show).map((b, i) =>
                "photo" in b && b.photo ? (
                  <div key={i} className="sms-photo">
                    📷<span>IMG_4821 · 2 photos</span>
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`sms ${b.who === "me" ? "me" : "them"}`}
                    style={
                      b.who === "me"
                        ? {
                            alignSelf: "flex-end",
                            background: "#007AFF",
                            color: "#fff",
                            borderRadius: "17px 17px 4px 17px",
                            padding: "8px 12px",
                            maxWidth: "78%",
                            fontSize: 13.5,
                            lineHeight: 1.35,
                            whiteSpace: "pre-wrap",
                          }
                        : {
                            alignSelf: "flex-start",
                            background: "#e5e5ea",
                            color: "#000",
                            borderRadius: "17px 17px 17px 4px",
                            padding: "8px 12px",
                            maxWidth: "78%",
                            fontSize: 13.5,
                            lineHeight: 1.35,
                            whiteSpace: "pre-wrap",
                          }
                    }
                  >
                    {"t" in b ? b.t : ""}
                  </div>
                )
              )}
            </div>
            {/* Chip */}
            <div style={{ textAlign: "center" }}>{chip}</div>
            {/* Input bar */}
            <div className="iph-input">
              <div className="iph-field">Text Message · SMS</div>
              <button
                className="iph-send"
                onClick={() => setStep((s) => Math.min(2, s + 1))}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Thread row
// ============================================================================

interface ThreadRowProps {
  lead: SampleLead;
  onClick: () => void;
}

function ThreadRow({ lead: l, onClick }: ThreadRowProps) {
  return (
    <div
      className={`msg-row ${l.unread ? "unread" : ""}`}
      onClick={onClick}
    >
      <span
        className="javatar"
        style={{
          width: 38,
          height: 38,
          fontSize: 13,
          background: "var(--manila-2)",
          color: "var(--ink-2)",
        }}
      >
        {leadInitials(l.name)}
      </span>
      <div className="msg-main">
        <div className="msg-nm">
          {l.name}
          {l.unread ? <span className="msg-dot" /> : null}
        </div>
        <div className="msg-snip">{lastMsg(l) || "No messages yet"}</div>
      </div>
      {l.phone ? <span className="msg-tm">{l.phone}</span> : null}
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function MessagesPage() {
  const [aiOpen, setAiOpen] = useState(false);
  const [myTech] = useState(1); // prototype: state.myTech = 1 (Mike Rivera)

  const tc: SampleTech | undefined =
    SAMPLE_TECHS.find((t) => t.id === myTech) ?? SAMPLE_TECHS[0];

  // Prototype: techCanText() — perms.techTexts is on by default
  const techCanText = true;

  if (!techCanText) {
    return (
      <>
        <h1>Messages</h1>
        <div className="empty-att">
          Texting from the field is off — ask the office to turn it on.
        </div>
      </>
    );
  }

  if (aiOpen) {
    return <AiPhone onBack={() => setAiOpen(false)} />;
  }

  const threads = tc ? techThreads(tc.id) : [];

  return (
    <>
      <h1>Messages</h1>
      <div className="msg-list">
        {/* Mallet AI row (always first) */}
        <div
          className="msg-row"
          style={{ borderColor: "var(--ink)" }}
          onClick={() => setAiOpen(true)}
        >
          <span
            className="javatar"
            style={{
              width: 38,
              height: 38,
              fontSize: 17,
              background: "var(--ink)",
              color: "var(--paper)",
            }}
          >
            ✦
          </span>
          <div className="msg-main">
            <div className="msg-nm">Mallet AI</div>
            <div className="msg-snip">
              Text it to log work, photos &amp; hours — from any phone
            </div>
          </div>
          <span className="msg-tm">try it ›</span>
        </div>

        {/* Customer threads */}
        {threads.map((l) => (
          <ThreadRow
            key={l.id}
            lead={l}
            onClick={() => stub("openThread", l.id)}
          />
        ))}

        {threads.length === 0 ? (
          <div className="empty-att">No messages yet.</div>
        ) : null}
      </div>
    </>
  );
}
