"use client";

/**
 * Composer page — "New quote".
 * Wired to the Zustand app-store (leads + estimates). One layout, read
 * top-to-bottom: Customer → The quote → Pricing → Message → Send. The quote
 * card carries the format toggle (single quote ↔ Good/Better/Best); the page
 * orchestrates, the sections live in sibling components:
 *   composer-state.ts   — ComposerState + pure helpers (single source of truth)
 *   customer-selector   — pick / quick-add the customer
 *   quote-card          — format toggle, authoring tools, AI panel, totals
 *   line-table          — the shared line-editor grid (single + tier panels)
 *   gbb-tiers           — the Good/Better/Best tier panels
 *   gbb-suggest         — "Suggest Better & Best from Good" heuristics (not AI)
 *   pricing-card        — discount / deposit / tax
 *   message-card        — intro (leads the send body) + valid days
 *   send-card           — channel, destination, follow-ups, action row
 *
 * A GBB quote saves / previews / sends the FULL three-tier structure (every
 * real line tagged with its tier + recommendedTier + tierNames) — customers
 * pick one of the three options on their quote page. linesForSend() (the
 * recommended tier at call time) drives gating + the totals display only.
 *
 * The quote card reads the real pricebook (s.services) for "From pricebook"
 * and writes to it via saveLineToBook (s.addService) for each line's "Save
 * to book" chip — both directions wired to the store, no sample data.
 *
 * Deferred (intentional no-op — see inline comment in quote-card.tsx):
 *   - descMic() / 🎤     — no speech API in the app yet
 */

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLeads, useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import { api } from "@/lib/trpc/client";
import {
  INITIAL_STATE,
  aiDraftForPayload,
  applyAiDraftLines,
  applyAiDraftTiers,
  applyComposerPatch,
  buildQuoteMessageBody,
  deliveryGateReason,
  hasRealLine,
  linesForSend,
  realLines,
  recommendedTier,
  sendGateReason,
  tierDisplayName,
  tieredLinesForPayload,
  tierNamesForPayload,
  toEstimateLines,
  type AiTiersDraft,
  type ComposerLine,
  type ComposerState,
  type TierKey,
} from "./composer-state";
import { suggestFromGood } from "./gbb-suggest";
import { CustomerSelector } from "./customer-selector";
import { QuoteCard } from "./quote-card";
import { PricingCard } from "./pricing-card";
import { MessageCard } from "./message-card";
import { SendCard } from "./send-card";

export default function ComposerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leads = useLeads();
  const addEstimate = useAppStore((s) => s.addEstimate);
  const adoptEstimate = useAppStore((s) => s.adoptEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  // The real pricebook catalog — "From pricebook" reads it; "Save to book" writes to it.
  const services = useAppStore((s) => s.services);
  const laborRates = useAppStore((s) => s.laborRates);
  const addService = useAppStore((s) => s.addService);

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

  // Shared error copy for both AI drafters (single + tiered) — same failure modes.
  function onAiDraftError(err: { data?: { code?: string } | null }) {
    setRun(null);
    setRunResult(null);
    const code = err.data?.code;
    if (code === "PRECONDITION_FAILED") {
      setAiDraftError("AI isn't enabled yet — ask your admin to add the API key.");
    } else if (code === "TOO_MANY_REQUESTS") {
      setAiDraftError("AI is busy right now — try again in a moment.");
    } else {
      setAiDraftError("Couldn't draft with AI — try rephrasing, or add lines manually.");
    }
  }

  // rateCents → dollars (ComposerLine.r is in dollars, e.g. r:170 = $170)
  function toComposerLines(lines: { description: string; quantity: number; rateCents: number }[]): ComposerLine[] {
    return lines.map((l) => ({ d: l.description, q: l.quantity, r: l.rateCents / 100 }));
  }

  // The drafters gather lead context server-side when given a real (persisted)
  // lead id. Store-local drafts can carry non-uuid ids — send nothing for those.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidOrUndefined(id: string | null): string | undefined {
    return id && UUID_RE.test(id) ? id : undefined;
  }

  // The staged run reveal: set when a draft starts; carries the lead id so the
  // gather query (fired at t=0, concurrent with the model call) shows real
  // job-info counts while the model works. Lines apply to state the moment the
  // mutation resolves — the reveal is purely presentational on top.
  const [run, setRun] = useState<{ leadId: string | undefined } | null>(null);
  const [runResult, setRunResult] = useState<{ wonQuotes: { count: number; nums: string[] } } | null>(null);
  const [materialize, setMaterialize] = useState(false);
  const gatherQuery = api.v1.ai.gatherJobContext.useQuery(
    { leadId: run?.leadId ?? "" },
    { enabled: Boolean(run?.leadId), staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  );

  function finishRun() {
    setRun(null);
    setRunResult(null);
    setMaterialize(true);
    setTimeout(() => setMaterialize(false), 1_600);
  }

  // Single-format drafter: one set of lines into the table (or the Good tier
  // when a mid-flight format switch landed the response in GBB).
  const draftEstimateMutation = api.v1.ai.draftEstimate.useMutation({
    onSuccess: (data) => {
      setCs((prev) => applyAiDraftLines(prev, toComposerLines(data.lines)));
      setAiDraftError(null);
      setRunResult({ wonQuotes: data.stages.wonQuotes });
    },
    onError: onAiDraftError,
  });

  // GBB drafter: fills ALL THREE tier panels + stars the AI's recommended key.
  const draftTiersMutation = api.v1.ai.draftEstimateTiers.useMutation({
    onSuccess: (data) => {
      const draft: AiTiersDraft = {
        recommended: data.recommended,
        good: { note: data.good.note, lines: toComposerLines(data.good.lines) },
        better: { note: data.better.note, lines: toComposerLines(data.better.lines) },
        best: { note: data.best.note, lines: toComposerLines(data.best.lines) },
      };
      setCs((prev) => applyAiDraftTiers(prev, draft));
      setAiDraftError(null);
      setRunResult({ wonQuotes: data.stages.wonQuotes });
    },
    onError: onAiDraftError,
  });

  function update(patch: Partial<ComposerState>) {
    // applyComposerPatch clears a stale format-switch note on line/tier edits.
    setCs((prev) => applyComposerPatch(prev, patch));
  }

  function triggerAiDraft() {
    if (!cs.desc.trim()) return;
    setAiDraftError(null);
    const leadId = uuidOrUndefined(cs.leadId);
    setRun({ leadId });
    setRunResult(null);
    // GBB format drafts all three options; single format keeps the one-shot lines.
    if (cs.format === "gbb" && cs.gbb) {
      draftTiersMutation.mutate({ description: cs.desc, leadId });
    } else {
      draftEstimateMutation.mutate({ description: cs.desc, leadId });
    }
  }

  // "Save to book" (line-table.tsx) — snapshots the line's current values into
  // a new pricebook service. Editing the line afterward never rewrites the
  // saved service (and vice versa) — they're independent from this point on.
  function saveLineToBook(line: ComposerLine): Promise<AddResult> {
    return addService({ name: line.d, unitPrice: line.r, cost: line.c ?? 0 });
  }

  const selectedLead: Lead | null =
    cs.leadId != null ? (leads.find((l) => l.id === cs.leadId) ?? null) : null;

  // "Suggest Better & Best from Good" — pure heuristics (gbb-suggest.ts), NOT
  // AI: keeps the user's Good tier verbatim and fills Better/Best from the
  // trade seed matching the job wording (Good's lines + the AI-describe text +
  // the lead's job), else the generic fallback derived from Good's lines.
  function suggestBetterBest() {
    setCs((prev) => {
      if (prev.format !== "gbb" || !prev.gbb) return prev;
      const good = prev.gbb.opts.find((o) => o.k === "good") ?? prev.gbb.opts[0];
      if (!good) return prev;
      const jobText = [
        good.lines.map((l) => l.d).join(" "),
        prev.desc,
        selectedLead?.job ?? "",
      ].join(" ");
      // Replaces Better & Best (the quote card confirms first when they hold
      // real lines); the star preservation rule lives in suggestFromGood.
      // Any format-switch note is stale after the rewrite.
      return { ...prev, gbb: suggestFromGood(prev.gbb, jobText), switchNote: null };
    });
  }

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
  // ALL of them derive the payload at call time; a GBB quote always carries
  // the full three-tier structure (gating keys off the recommended tier).

  function saveDraftComposer() {
    // Gate on the recommended tier's real lines (mirrors the domain's send
    // rule) — the server's draft schema rejects `description: ""` and the
    // optimistic estimate would roll back silently AFTER the redirect.
    const gateLines = realLines(linesForSend(cs));
    if (gateLines.length === 0) return;
    // Draft requires a lead because addEstimate needs a real leadId.
    if (!selectedLead) return;
    // GBB saves the FULL three-tier structure; single saves the line table.
    const gbb = cs.format === "gbb" && cs.gbb ? cs.gbb : null;
    addEstimate({
      leadId: selectedLead.id,
      title: selectedLead.job || "Quote draft",
      status: "draft",
      age: 0,
      viewed: false,
      fu: { on: cs.fuOn, stage: 0 },
      lines: toEstimateLines(gbb ? tieredLinesForPayload(gbb) : gateLines),
      pricing: { ...cs.pricing },
      validDays: cs.validDays,
      ...(gbb
        ? { recommendedTier: gbb.rec, tierNames: tierNamesForPayload(gbb) }
        : {}),
      ...(cs.terms ? { termsSnapshot: cs.terms.text } : {}),
    });
    // Quotes live in the Pipeline rail (the /quotes route just redirects here);
    // the new draft lands in the "in the shop" lane.
    router.push("/pipeline");
  }

  // The v1.quoting.draft payload built from the current composer state — shared by the
  // send flow and the preview flow so they draft an identical estimate. A GBB quote
  // carries ALL tiers' lines (tier-tagged) + recommendedTier + tierNames; the customer
  // picks one of the three options on their quote page. termsSnapshot rides both formats.
  function buildDraftPayload(lead: NonNullable<typeof selectedLead>) {
    const gbb = cs.format === "gbb" && cs.gbb ? cs.gbb : null;
    const payloadLines: (ComposerLine & { tier?: TierKey })[] = gbb
      ? tieredLinesForPayload(gbb)
      : realLines(cs.lines);
    return {
      leadId: lead.id,
      title: lead.job || "Quote",
      discBps: Math.round((cs.pricing.disc ?? 0) * 100),
      taxBps: Math.round((cs.pricing.tax ?? 0) * 100),
      depBps: Math.round((cs.pricing.dep ?? 0) * 100),
      validDays: cs.validDays,
      lines: payloadLines.map((l) => ({
        description: l.d,
        quantity: l.q ?? 1,
        rateCents: Math.round((l.r ?? 0) * 100),
        costCents: Math.round((l.c ?? 0) * 100),
        isOptional: l.opt ?? false,
        needsPhoto: l.photo ?? false,
        tier: l.tier,
      })),
      ...(gbb
        ? { recommendedTier: gbb.rec, tierNames: tierNamesForPayload(gbb) }
        : {}),
      ...(cs.terms?.text.trim() ? { termsSnapshot: cs.terms.text } : {}),
      // AI-originated quotes carry the AI's original lines so the server can
      // diff what the office changed (edit-delta mining → proposed rules).
      ...(() => {
        const aiDraft = aiDraftForPayload(cs);
        return aiDraft ? { aiDraft } : {};
      })(),
    };
  }

  async function sendComposer() {
    if (!selectedLead) return; // send requires a lead
    if (!hasRealLine(linesForSend(cs))) return;
    // Send-only gate: no destination on file for the chosen channel. The Send
    // button disables with the reason; this early return is defense-in-depth —
    // a destination-less send would persist + mark the estimate sent, then
    // fail delivery with a misleading error, and a retry would mint a
    // duplicate estimate.
    if (deliveryGateReason(cs.sendChannel, selectedLead) != null) return;

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
  // In GBB format that includes the three-option tier picker.
  async function previewComposer() {
    if (!selectedLead) return;
    if (!hasRealLine(linesForSend(cs))) return;
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

  // Gate inputs for the send card: tier label (falls back when a custom name
  // trims empty) + the chosen channel's destination check (gates Send only).
  const recTier = recommendedTier(cs);
  const recTierName = recTier ? tierDisplayName(recTier) : null;

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

      {/* The quote — format toggle, authoring tools, line editor / tier panels */}
      <QuoteCard
        state={cs}
        onUpdate={update}
        onAiDraft={triggerAiDraft}
        onSuggestBetterBest={suggestBetterBest}
        isDrafting={draftEstimateMutation.isPending || draftTiersMutation.isPending}
        aiDraftError={aiDraftError}
        services={services}
        onSaveToBook={saveLineToBook}
        run={
          run
            ? {
                hasLead: Boolean(run.leadId),
                gather: gatherQuery.data?.counts ?? null,
                pricebook: { services: services.length, laborRates: laborRates.length },
                result: runResult,
              }
            : null
        }
        onRunDone={finishRun}
        materialize={materialize}
      />

      {/* Pricing — discount, deposit, tax */}
      <PricingCard state={cs} onUpdate={update} />

      {/* Message — intro + valid days */}
      <MessageCard state={cs} onUpdate={update} lead={selectedLead} />

      {/* Send — channel, destination, follow-ups, actions (the last act) */}
      <SendCard
        lead={selectedLead}
        state={cs}
        onUpdate={update}
        gateReason={sendGateReason(selectedLead != null, linesForSend(cs), recTierName)}
        deliveryGateReason={
          selectedLead != null
            ? deliveryGateReason(cs.sendChannel, selectedLead)
            : null
        }
        isSending={isSending}
        sendError={sendError}
        onPreview={previewComposer}
        onSaveDraft={saveDraftComposer}
        onSend={sendComposer}
      />
    </div>
  );
}
