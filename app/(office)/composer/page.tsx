"use client";

/**
 * Composer page — pixel-faithful port of the prototype's vComposer().
 * Renders the "New quote" Good · Better · Best composer.
 * Wired to the Zustand app-store (leads + estimates). The markup mirrors the
 * prototype; only the action handlers are live.
 *
 * The page reads top-to-bottom: Customer → The quote → Pricing → Message →
 * Send. The page orchestrates; the sections live in sibling components:
 *   composer-state.ts   — ComposerState + pure helpers (single source of truth)
 *   customer-selector   — pick / quick-add the customer
 *   quote-card          — line items, totals, pricebook, AI panel
 *   line-table          — the shared line-editor grid
 *   pricing-card        — discount / deposit / tax
 *   message-card        — intro (leads the send body) + valid days
 *   send-card           — channel, destination, follow-ups, action row
 *   gbb-modes           — Good/Better/Best prompt + review
 *
 * Prototype reference: elas-crm-prototype.html lines 7031–7139.
 *
 * Deferred (intentional no-ops — see inline comments in the components):
 *   - savePbLine(i)      — needs a store pricebook
 *   - descMic() / 🎤     — no speech API in the app yet
 */

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLeads, useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import { api } from "@/lib/trpc/client";
import {
  INITIAL_STATE,
  buildQuoteMessageBody,
  hasRealLine,
  sendGateReason,
  toEstimateLines,
  type ComposerLine,
  type ComposerState,
  type GBBDraft,
} from "./composer-state";
import { CustomerSelector } from "./customer-selector";
import { QuoteCard } from "./quote-card";
import { PricingCard } from "./pricing-card";
import { MessageCard } from "./message-card";
import { SendCard } from "./send-card";
import { GBBPromptMode, GBBReviewMode } from "./gbb-modes";

// ---- Builder mode (standard single-quote) -----------------------------------

function BuilderMode({
  state,
  onUpdate,
  leads,
  onSaveDraft,
  onSend,
  onPreview,
  onAiDraft,
  isDrafting,
  aiDraftError,
  isSending,
  sendError,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leads: Lead[];
  onSaveDraft: () => void;
  onSend: () => void;
  onPreview: () => void;
  onAiDraft: () => void;
  isDrafting: boolean;
  aiDraftError: string | null;
  isSending: boolean;
  sendError: string | null;
}) {
  const lead: Lead | null =
    state.leadId != null
      ? (leads.find((l) => l.id === state.leadId) ?? null)
      : null;

  // Return to the 3-option review: write current lines back into the edited
  // tier, then restore the builder to the recommended tier's lines.
  function backToAll3() {
    const g = state.gbb;
    const edited = state.gbbEdit;
    if (!g || !edited) {
      onUpdate({ mode: "gbb-review", gbbEdit: null });
      return;
    }
    const nextGbb: GBBDraft = {
      ...g,
      opts: g.opts.map((o) =>
        o.k === edited
          ? {
              ...o,
              lines: state.lines.map((l) => ({
                d: l.d,
                q: l.q,
                r: l.r,
                ...(l.c != null ? { c: l.c } : {}),
                ...(l.opt != null ? { opt: l.opt } : {}),
                ...(l.photo != null ? { photo: l.photo } : {}),
                ...(l.tune != null ? { tune: l.tune } : {}),
                ...(l.lc != null ? { lc: l.lc } : {}),
              })),
            }
          : o
      ),
    };
    const rec = nextGbb.opts.find((o) => o.k === nextGbb.rec) ?? nextGbb.opts[0];
    onUpdate({
      mode: "gbb-review",
      gbbEdit: null,
      gbb: nextGbb,
      lines: (rec?.lines ?? []).map((l) => ({ ...l })),
    });
  }

  return (
    <>
      {state.gbbEdit && (
        <div className="banner">
          Editing the <b>{state.gbbEdit.toUpperCase()}</b> option — changes save
          into that tier.{" "}
          <span className="linklike" onClick={backToAll3}>
            ← back to all 3
          </span>
        </div>
      )}

      {/* The quote — line items, totals, authoring tools */}
      <QuoteCard
        state={state}
        onUpdate={onUpdate}
        onAiDraft={onAiDraft}
        isDrafting={isDrafting}
        aiDraftError={aiDraftError}
      />

      {/* Pricing — discount, deposit, tax */}
      <PricingCard state={state} onUpdate={onUpdate} />

      {/* Message — intro + valid days */}
      <MessageCard state={state} onUpdate={onUpdate} lead={lead} />

      {/* Send — channel, destination, follow-ups, actions (the last act) */}
      <SendCard
        lead={lead}
        state={state}
        onUpdate={onUpdate}
        gateReason={sendGateReason(lead != null, state.lines)}
        isSending={isSending}
        sendError={sendError}
        onPreview={onPreview}
        onSaveDraft={onSaveDraft}
        onSend={onSend}
      />
    </>
  );
}

// ---- Main page --------------------------------------------------------------

export default function ComposerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leads = useLeads();
  const addEstimate = useAppStore((s) => s.addEstimate);
  const adoptEstimate = useAppStore((s) => s.adoptEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const addLeadNote = useAppStore((s) => s.addLeadNote);

  // Seed leadId from ?lead= once (read-only initializer so state edits persist).
  const [cs, setCs] = useState<ComposerState>(() => {
    const raw = searchParams.get("lead");
    const leadId = raw != null && raw !== "" ? raw : null;
    return { ...INITIAL_STATE, leadId };
  });

  const [aiDraftError, setAiDraftError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [custError, setCustError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Invalidates the cached customer list so the leads hydrator picks up a
  // freshly-created customer (with its server-assigned id) into the store.
  const utils = api.useUtils();

  // ---- tRPC mutations for the real send flow --------------------------------

  // Step 1: persist the estimate draft (returns publicToken among other fields).
  const quoteDraftMutation = api.v1.quoting.draft.useMutation();
  // Step 2: mark the estimate as sent (stamps sentAt).
  const quoteSendMutation = api.v1.quoting.send.useMutation();
  // Preview drafts persisted this composer session: reused per distinct state (no
  // duplicate drafts on re-click) and archived once the real send supersedes them.
  const previewDraftsRef = useRef<{ key: string; id: string; token: string | null }[]>([]);
  const quoteArchiveMutation = api.v1.quoting.archive.useMutation();
  // Step 3a: send SMS via Twilio (gated on A2P provisioning).
  const messagingSendMutation = api.v1.messaging.send.useMutation();
  // Step 3b: send the quote link by email via the notifications sender (Resend,
  // gated server-side on RESEND_API_KEY + EMAIL_FROM).
  const notificationsSendMutation = api.v1.notifications.send.useMutation();
  // Inline "+ Add new customer" — persists a real DB lead so quotes can reference it.
  const createCustomerMutation = api.v1.customers.create.useMutation();

  const draftEstimateMutation = api.v1.ai.draftEstimate.useMutation({
    onSuccess: (data) => {
      const lines: ComposerLine[] = data.lines.map((l) => ({
        d: l.description,
        q: l.quantity,
        // rateCents → dollars (ComposerLine.r is in dollars, e.g. r:170 = $170)
        r: l.rateCents / 100,
      }));
      setCs((prev) => ({
        ...prev,
        lines,
        aiOpen: false,
        aiDrafted: true,
      }));
      setAiDraftError(null);
    },
    onError: (err) => {
      const code = err.data?.code;
      if (code === "PRECONDITION_FAILED") {
        setAiDraftError("AI isn't enabled yet — ask your admin to add the API key.");
      } else if (code === "TOO_MANY_REQUESTS") {
        setAiDraftError("AI is busy right now — try again in a moment.");
      } else {
        setAiDraftError("Couldn't draft with AI — try rephrasing, or add lines manually.");
      }
    },
  });

  function update(patch: Partial<ComposerState>) {
    setCs((prev) => ({ ...prev, ...patch }));
  }

  function triggerAiDraft() {
    if (!cs.desc.trim()) return;
    setAiDraftError(null);
    draftEstimateMutation.mutate({ description: cs.desc });
  }

  const selectedLead: Lead | null =
    cs.leadId != null ? (leads.find((l) => l.id === cs.leadId) ?? null) : null;

  // Default the send channel from the customer's contact info, once per lead:
  // text when they have a mobile on file (or nothing yet), email when email is
  // all we have. A manual toggle after that sticks until the customer changes.
  const channelDefaultedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLead) return;
    if (channelDefaultedFor.current === selectedLead.id) return;
    channelDefaultedFor.current = selectedLead.id;
    const hasPhone = !!selectedLead.phone && selectedLead.phone !== "—";
    const hasEmail = !!selectedLead.email;
    setCs((prev) => ({
      ...prev,
      sendChannel: !hasPhone && hasEmail ? "email" : "text",
    }));
  }, [selectedLead]);

  // --- persistence helpers --------------------------------------------------
  // The action buttons disable (with the reason inline) while these guards
  // fail — the early returns are defense-in-depth, not the primary gate.

  function saveDraftComposer() {
    if (!hasRealLine(cs.lines)) return;
    // Draft requires a lead because addEstimate needs a real leadId.
    if (!selectedLead) return;
    addEstimate({
      leadId: selectedLead.id,
      title: selectedLead.job || "Quote draft",
      status: "draft",
      age: 0,
      viewed: false,
      fu: { on: cs.fuOn, stage: 0 },
      lines: toEstimateLines(cs.lines),
      pricing: { ...cs.pricing },
      validDays: cs.validDays,
    });
    // Quotes live in the Pipeline rail (the /quotes route just redirects here);
    // the new draft lands in the "in the shop" lane.
    router.push("/pipeline");
  }

  // The v1.quoting.draft payload built from the current composer state — shared by the
  // send flow and the preview flow so they draft an identical estimate.
  function buildDraftPayload(lead: NonNullable<typeof selectedLead>) {
    return {
      leadId: lead.id,
      title: lead.job || "Quote",
      discBps: Math.round((cs.pricing.disc ?? 0) * 100),
      taxBps: Math.round((cs.pricing.tax ?? 0) * 100),
      depBps: Math.round((cs.pricing.dep ?? 0) * 100),
      validDays: cs.validDays,
      lines: cs.lines
        .filter((l) => (l.d ?? "").trim())
        .map((l) => ({
          description: l.d,
          quantity: l.q ?? 1,
          rateCents: Math.round((l.r ?? 0) * 100),
          costCents: Math.round(((l as ComposerLine).c ?? 0) * 100),
          isOptional: (l as ComposerLine).opt ?? false,
          needsPhoto: (l as ComposerLine).photo ?? false,
        })),
    };
  }

  async function sendComposer() {
    if (!selectedLead) return; // send requires a lead
    if (!hasRealLine(cs.lines)) return;

    setSendError(null);
    setIsSending(true);

    try {
      // Step 1: persist the estimate draft. The backend generates a publicToken.
      const drafted = await quoteDraftMutation.mutateAsync(buildDraftPayload(selectedLead));

      // Step 2: mark the estimate as sent (stamps sentAt). Returns the SENT dto.
      const sentDto = await quoteSendMutation.mutateAsync({ estimateId: drafted.id });

      // Step 3: deliver the quote link via the selected channel.
      // The public link is /q/<token>. Use the current origin so it works in
      // any environment (dev / staging / prod) without a server-only env var.
      const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const quoteLink =
        drafted.publicToken
          ? `${appOrigin}/q/${drafted.publicToken}`
          : appOrigin; // fallback if token not yet set (shouldn't happen)

      // The intro from the Message card (or the auto-intro fallback) leads the
      // body on both channels.
      const body = buildQuoteMessageBody({
        firstName: selectedLead.name.split(" ")[0] ?? selectedLead.name,
        intro: cs.intro,
        quoteNum: drafted.num,
        quoteLink,
      });

      if (cs.sendChannel === "text") {
        // SMS — gated: requires Twilio + A2P. Server returns PRECONDITION_FAILED
        // when unconfigured (no number provisioned). Wire the call regardless;
        // error is shown inline so the user knows delivery didn't go out.
        await messagingSendMutation.mutateAsync({
          leadId: selectedLead.id,
          body,
        });
      } else {
        // Email — deliver the quote link via the notifications sender (Resend). Gated
        // server-side on RESEND_API_KEY + EMAIL_FROM; a PRECONDITION_FAILED means email
        // isn't configured (caught below and surfaced inline — the quote is still saved).
        await notificationsSendMutation.mutateAsync({
          channel: "email",
          to: selectedLead.email ?? "",
          kind: "estimate_sent",
          body,
          relatedType: "estimate",
          relatedId: drafted.id,
          idempotencyKey: `estimate-sent-${drafted.id}`,
        });
      }

      // Store update so the pipeline reflects the new estimate. Adopt the SERVER's
      // sent record — the draft+send above already persisted it; going through
      // addEstimate here would fire a second quoting.draft and orphan a duplicate
      // draft in the shop rail.
      adoptEstimate(sentDto, { on: cs.fuOn, stage: 0 });

      // Preview drafts from this composer session are superseded by the real send —
      // archive them so they don't linger in the shop rail (best-effort; a failed
      // archive just leaves a draft the user can trash from the estimate modal).
      for (const p of previewDraftsRef.current) {
        quoteArchiveMutation.mutate(
          { estimateId: p.id },
          {
            onError: (err) => {
              if (process.env.NODE_ENV !== "production") {
                console.error("[composer] preview-draft archive failed", { estimateId: p.id, err });
              }
            },
          },
        );
      }
      previewDraftsRef.current = [];

      addLeadNote(selectedLead.id, {
        type: "text",
        from: "auto",
        t: `Your quote ${drafted.num} is ready — view and approve.`,
        when: "Just now",
      });

      if (
        STAGE_ORDER.indexOf(selectedLead.stage as (typeof STAGE_ORDER)[number]) <
        STAGE_ORDER.indexOf("Quote Sent")
      ) {
        moveLeadStage(selectedLead.id, "Quote Sent");
      }

      router.push("/pipeline");
    } catch (e: unknown) {
      // Surface the error inline. A PRECONDITION_FAILED from messaging means the
      // quote was persisted + marked sent — only delivery failed.
      const code = (e as { data?: { code?: string } }).data?.code;
      if (code === "PRECONDITION_FAILED") {
        setSendError(
          cs.sendChannel === "text"
            ? "Quote saved — but no business number is set up for texting yet. Share the link manually."
            : "Quote saved — email delivery isn't configured yet. Share the link manually.",
        );
      } else if (code === "BAD_GATEWAY") {
        // The provider rejected the send (e.g. Resend refused the from-address/key).
        setSendError(
          cs.sendChannel === "text"
            ? "Quote saved — the texting provider rejected the send. Check the Twilio setup."
            : "Quote saved — the email provider rejected the send. Check EMAIL_FROM and the Resend key.",
        );
      } else {
        setSendError("Couldn't send the quote — check your connection and try again.");
      }
    } finally {
      setIsSending(false);
    }
  }

  // Preview: persist a draft to mint a public token, then open the customer-facing
  // quote page (/q/<token>) in a new tab — the exact view the customer will see.
  async function previewComposer() {
    if (!selectedLead) return;
    if (!hasRealLine(cs.lines)) return;
    setSendError(null);
    try {
      const payload = buildDraftPayload(selectedLead);
      // One preview draft per distinct composer state: re-clicking Preview without
      // changing anything reuses the same draft instead of persisting another one.
      const key = JSON.stringify(payload);
      const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const cached = previewDraftsRef.current.find((p) => p.key === key);
      if (cached?.token) {
        window.open(`${appOrigin}/q/${cached.token}`, "_blank", "noopener");
        return;
      }
      const drafted = await quoteDraftMutation.mutateAsync(payload);
      previewDraftsRef.current.push({ key, id: drafted.id, token: drafted.publicToken ?? null });
      if (drafted.publicToken) {
        window.open(`${appOrigin}/q/${drafted.publicToken}`, "_blank", "noopener");
      }
    } catch {
      setSendError("Couldn't open the preview — check your connection and try again.");
    }
  }

  async function composerNewCust() {
    // In-flight guard: if a create is already pending (e.g. the user double-
    // clicked or hit Enter twice), drop the extra invocation immediately so we
    // never fire two concurrent creates for the same name.
    if (createCustomerMutation.isPending) return;

    const name = cs.custQuery.trim();
    if (!name) return;

    // Client-side dedupe: if a lead with this name (case-insensitive) already
    // exists in the store, select it instead of creating a duplicate.
    const nameLower = name.toLowerCase();
    const existing = leads.find((l) => (l.name ?? "").trim().toLowerCase() === nameLower);
    if (existing) {
      update({ leadId: existing.id, custQuery: "" });
      return;
    }

    setCustError(null);
    try {
      // Persist a real DB lead (server assigns the id). Without this the quote's
      // leadId would point at a row that doesn't exist and the draft/send would
      // be rejected server-side and silently rolled back.
      const data = await createCustomerMutation.mutateAsync({
        name,
        source: "Added manually",
      });
      // Refetch the customer list so the leads hydrator writes the new lead into
      // the store; then select it by its server id.
      await utils.v1.customers.list.invalidate();
      update({ leadId: data.id, custQuery: "" });
    } catch {
      setCustError("Couldn't add the customer — check your connection and try again.");
    }
  }

  function editTier(k: "good" | "better" | "best") {
    const tier = cs.gbb?.opts.find((o) => o.k === k);
    if (!tier) return;
    update({
      mode: "builder",
      gbbEdit: k,
      lines: tier.lines.map((l) => ({ ...l })),
    });
  }

  return (
    <div>
      <h1>New quote</h1>

      <CustomerSelector
        state={cs}
        onUpdate={update}
        leads={leads}
        onNewCust={composerNewCust}
        isAddingCust={createCustomerMutation.isPending}
      />
      {custError && (
        <p style={{ color: "var(--red, #b42318)", fontSize: 13, margin: "-8px 0 12px" }}>
          {custError}
        </p>
      )}

      {cs.mode === "gbb-prompt" && (
        <GBBPromptMode state={cs} onUpdate={update} selectedLead={selectedLead} />
      )}
      {cs.mode === "gbb-review" && cs.gbb && (
        <GBBReviewMode
          state={cs}
          onUpdate={update}
          onEditTier={editTier}
          onSendAll3={sendComposer}
          onPreview={previewComposer}
        />
      )}
      {cs.mode === "builder" && (
        <BuilderMode
          state={cs}
          onUpdate={update}
          leads={leads}
          onSaveDraft={saveDraftComposer}
          onSend={sendComposer}
          onPreview={previewComposer}
          onAiDraft={triggerAiDraft}
          isDrafting={draftEstimateMutation.isPending}
          aiDraftError={aiDraftError}
          isSending={isSending}
          sendError={sendError}
        />
      )}
    </div>
  );
}
