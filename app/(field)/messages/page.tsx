"use client";

/**
 * Messages page.
 *
 *   1. The pinned "Artie" card (a separate AI-logging surface, unchanged).
 *   2. MessagesInbox — one two-pane inbox holding BOTH kinds of conversation:
 *      customers (owner/office, over the business number) and team (every role,
 *      internal). The list and the thread live side by side; nothing overlays.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useMe } from "@/features/identity/hooks";
import { pressable } from "@/lib/a11y";
import { MessagesInbox } from "@/features/team-chat/messages-inbox";

// ============================================================================
// AI Phone mock (what a tech sees texting Artie from their own phone)
// Prototype: aiPhone() lines 3759-3787
// ============================================================================

const AI_CONVO = [
  { who: "me" as const, t: "Heading to the Hernandez job" },
  {
    who: "them" as const,
    t: "👍 En route to Two toilets · Sofia Hernandez — 318 Sycamore Rd. I texted her your ETA.",
  },
  { who: "me" as const, photo: true },
  { who: "me" as const, t: "all done — used 2 capacitors, 2.5 hrs on site" },
  {
    who: "them" as const,
    t: "✓ Logged to Two toilets — Hernandez:\n•  photo added to the job\n•  2.5 h on your timesheet\n•  2× capacitor added to materials\nReady to invoice. Reply UNDO to undo.",
  },
  {
    who: "me" as const,
    t: "wait — that was the Okafor AC job, not Hernandez",
  },
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
                            padding: "var(--space-2) var(--space-3)",
                            maxWidth: "78%",
                            fontSize: "var(--type-base)",
                            lineHeight: 1.35,
                            whiteSpace: "pre-wrap",
                          }
                        : {
                            alignSelf: "flex-start",
                            background: "#e5e5ea",
                            color: "#000",
                            borderRadius: "17px 17px 17px 4px",
                            padding: "var(--space-2) var(--space-3)",
                            maxWidth: "78%",
                            fontSize: "var(--type-base)",
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
// Page
// ============================================================================

interface MalletAiCardProps {
  onClick: () => void;
}

/** The pinned Artie row — a separate AI-logging surface, not a conversation. */
function MalletAiCard({ onClick }: MalletAiCardProps) {
  return (
    <div
      className="msg-row"
      style={{ borderColor: "var(--ink)" }}
      onClick={onClick}
      {...pressable(onClick)}
    >
      <span
        className="javatar"
        style={{
          width: 38,
          height: 38,
          fontSize: "var(--type-lg)",
          background: "var(--ink)",
          color: "var(--paper)",
        }}
      >
        ✦
      </span>
      <div className="msg-main">
        <div className="msg-nm">Artie</div>
        <div className="msg-snip">
          Text it to log work, photos &amp; hours — from any phone
        </div>
      </div>
      <span className="msg-tm">try it ›</span>
    </div>
  );
}

export default function MessagesPage() {
  const [aiOpen, setAiOpen] = useState(false);
  const { data: me, isLoading: meLoading } = useMe();

  if (aiOpen) {
    return <AiPhone onBack={() => setAiOpen(false)} />;
  }

  // Only owner/office may see the customer inbox. While the role query is in
  // flight we don't yet know the role, so hold off rendering the inbox to
  // avoid a transient FORBIDDEN flash from CustomerInbox.
  const canSeeInbox =
    !meLoading && (me?.role === "owner" || me?.role === "office");

  return (
    <>
      <h1>Messages</h1>
      <div className="msg-list">
        {/* Artie row — pinned first, visible to all roles */}
        <MalletAiCard onClick={() => setAiOpen(true)} />

      </div>

      {/* One inbox, two kinds of conversation. Customer texts stay owner/office
          (v1.messaging is ownerOrOffice); team conversations are every role, so a
          tech opens straight onto the side they can actually use. */}
      <MessagesInbox canSeeCustomers={canSeeInbox} meUserId={me?.userId} />
    </>
  );
}
