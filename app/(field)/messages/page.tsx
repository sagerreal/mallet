"use client";

/**
 * Messages page — pixel-faithful port of the prototype's vMessages() + aiPhone().
 *
 * Layout:
 *   1. Pinned "Mallet AI" crew card (unchanged — separate AI-logging surface).
 *   2. Customer Inbox powered by v1.messaging.listConversations (live DB).
 *
 * Clicking a customer row opens the existing ThreadModal for that leadId.
 */

import { useState } from "react";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { shortWhen } from "@/lib/format";
import { hasPhone, ADD_PHONE_TITLE } from "@/lib/phone";
import { useMe } from "@/features/identity/hooks";

function leadInitials(name: string): string {
  return (name ?? "?")
    .split(/\s+/)
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** One-line snippet: outbound messages are prefixed with "You: ". */
function snippet(body: string, direction: "inbound" | "outbound"): string {
  const prefix = direction === "outbound" ? "You: " : "";
  const full = prefix + body;
  return full.length > 72 ? full.slice(0, 72) + "…" : full;
}

// ============================================================================
// AI Phone mock (what a tech sees texting Mallet AI from their own phone)
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
// Customer conversation row
// ============================================================================

interface ConversationRowProps {
  leadId: string;
  leadName: string;
  /** null = no number on file — the thread can't send, so the row disables. */
  phone: string | null;
  lastBody: string;
  lastDirection: "inbound" | "outbound";
  lastAt: string;
  unread: boolean;
  onClick: () => void;
}

function ConversationRow({
  leadName,
  phone,
  lastBody,
  lastDirection,
  lastAt,
  unread,
  onClick,
}: ConversationRowProps) {
  // Field surface: disabled + title only (the lead modal is not reachable here).
  const disabled = !hasPhone({ phone });
  return (
    <div
      className={`msg-row${unread ? " unread" : ""}`}
      aria-disabled={disabled || undefined}
      title={disabled ? ADD_PHONE_TITLE : undefined}
      style={disabled ? { opacity: 0.55, cursor: "default" } : undefined}
      onClick={disabled ? undefined : onClick}
    >
      <span
        className="javatar"
        style={{
          width: 38,
          height: 38,
          fontSize: "var(--type-base)",
          background: "var(--manila-2)",
          color: "var(--ink-2)",
        }}
      >
        {leadInitials(leadName)}
      </span>
      <div className="msg-main">
        <div className="msg-nm">
          {leadName}
          {unread ? <span className="msg-dot" /> : null}
        </div>
        <div className="msg-snip">{snippet(lastBody, lastDirection)}</div>
      </div>
      <span className="msg-tm">{shortWhen(lastAt)}</span>
    </div>
  );
}

// ============================================================================
// Customer Inbox — live from v1.messaging.listConversations
// ============================================================================

function CustomerInbox() {
  const openModal = useOpenModal();

  // An inbox that never refetches is a screenshot. There is no realtime channel for messages, so
  // without a poll a tech watching this list would not see a customer's text arrive — and
  // refetchOnWindowFocus was off, which is exactly the moment (coming back to the app) a new one
  // is most likely to be waiting.
  const { data: conversations, isLoading } =
    api.v1.messaging.listConversations.useQuery(undefined, {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchInterval: 15_000,
    });

  if (isLoading) {
    return (
      <div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk-row">
            <div className="sk" style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)", justifyContent: "center" }}>
              <div className="sk" style={{ width: "60%", height: 14 }} />
              <div className="sk" style={{ width: "40%", height: 12 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <div className="empty-att">
        No customer messages yet — they&apos;ll appear here when a customer
        texts your business number.
      </div>
    );
  }

  return (
    <>
      {conversations.map((c) => (
        <ConversationRow
          key={c.leadId}
          leadId={c.leadId}
          leadName={c.leadName}
          phone={c.phone}
          lastBody={c.lastBody}
          lastDirection={c.lastDirection}
          lastAt={c.lastAt}
          unread={c.unread}
          onClick={() => openModal(MODAL.THREAD, { leadId: c.leadId })}
        />
      ))}
    </>
  );
}

// ============================================================================
// Mallet AI pinned card — visible to all roles
// ============================================================================

interface MalletAiCardProps {
  onClick: () => void;
}

function MalletAiCard({ onClick }: MalletAiCardProps) {
  return (
    <div
      className="msg-row"
      style={{ borderColor: "var(--ink)" }}
      onClick={onClick}
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
        <div className="msg-nm">Mallet AI</div>
        <div className="msg-snip">
          Text it to log work, photos &amp; hours — from any phone
        </div>
      </div>
      <span className="msg-tm">try it ›</span>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

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
        {/* Mallet AI row — pinned first, visible to all roles */}
        <MalletAiCard onClick={() => setAiOpen(true)} />

        {/* Customer inbox — only for owner/office once role is confirmed */}
        {canSeeInbox && <CustomerInbox />}
      </div>
    </>
  );
}
