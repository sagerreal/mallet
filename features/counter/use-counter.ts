/**
 * features/counter/use-counter.ts
 * The Counter's state machine. All input goes through the LLM agent
 * (v1.ai.run / v1.ai.resume). Sends (gate commits) go through the shared
 * commitOkSend primitive just as the Home queue does; every send hands back a
 * 30-second undo.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { firstName } from "@/features/home/derive";
import { clockNow, commitOkSend, dispatchOkSend } from "@/features/home/send";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import { matchRows, deriveSuggestions } from "./matcher";
import { api } from "@/lib/trpc/client";
import type { Artifact, Entry, Gate, OpenRef, Snap } from "./types";

const UNDO_MS = 30_000;
// Safeguard against unbounded payload / context growth: if the carried transcript
// exceeds this character count we start a fresh conversation instead of forwarding it.
const MAX_TRANSCRIPT_CHARS = 64_000;
let _entryId = 0;

export function useCounter() {
  const router = useRouter();
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const brand = useAppStore((s) => s.brand);
  const cmdSeed = useAppStore((s) => s.cmdSeed);
  const clearCmdSeed = useAppStore((s) => s.clearCmdSeed);

  // LLM agent mutations and utils for cache invalidation after agent writes.
  const agentRun = api.v1.ai.run.useMutation();
  const agentResume = api.v1.ai.resume.useMutation();
  const utils = api.useUtils();

  const [openState, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [, forceTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // In-conversation continuity: the transcript from the last completed agent turn is kept here and
  // forwarded to the next `run` call so the agent remembers earlier context (e.g. which customer
  // the user already named). Cleared when the panel closes or the user explicitly starts fresh.
  // Bounded by reset-on-close for now; a per-turn cap or token-size limit could be added later.
  const [activeTranscript, setActiveTranscript] = useState<string | null>(null);

  const snap: Snap = useMemo(
    () => ({ leads, estimates, invoices, jobs, techs, brandName: brand.name }),
    [leads, estimates, invoices, jobs, techs, brand.name]
  );

  const rows = useMemo(
    () => (value.trim().length >= 2 ? matchRows(value, snap) : []),
    [value, snap]
  );
  const suggestions = useMemo(() => deriveSuggestions(snap), [snap]);

  // 1s tick while any undo window is open (countdowns + expiry).
  const hasLiveUndo = entries.some(
    (e) => "sent" in e.artifact && e.artifact.sent && e.artifact.sent.expiresAt > Date.now()
  );
  useEffect(() => {
    if (!hasLiveUndo) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [hasLiveUndo]);

  const pushEntry = useCallback((request: string, artifact: Artifact) => {
    setEntries((prev) => [...prev, { id: ++_entryId, request, artifact }]);
    return _entryId;
  }, []);

  const patchArtifact = useCallback((entryId: number, patch: Partial<Artifact>) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId ? { ...e, artifact: { ...e.artifact, ...patch } as Artifact } : e
      )
    );
  }, []);

  const openRef = useCallback(
    (ref: OpenRef) => {
      const s = useAppStore.getState();
      if (ref.type === "page") router.push(ref.path);
      else if (ref.type === "lead") s.openModal(MODAL.LEAD, { leadId: ref.id });
      else if (ref.type === "thread") s.openModal(MODAL.THREAD, { leadId: ref.id });
      else if (ref.type === "est") s.openModal(MODAL.EST, { estId: ref.id });
      else if (ref.type === "invoice") s.openModal(MODAL.INVOICE, { invId: ref.id });
    },
    [router]
  );

  // ---- gate commits (the consequence boundary) --------------------------------

  const commitGate = useCallback((gate: Gate, text: string): (() => void) => {
    const s = useAppStore.getState();
    if (gate.kind === "ok-item") {
      const undoSend = commitOkSend(gate.item, text);
      s.dismissAttention(gate.item.key);
      const key = gate.item.key;
      const revert = () => {
        undoSend();
        useAppStore.getState().undismissAttention(key);
      };
      // REAL dispatch; failure reverts the commit (store rollback contract).
      dispatchOkSend(gate.item.lead.id, text).catch(revert);
      return revert;
    }
    if (gate.kind === "quote-send") {
      const est = s.estimates.find((e) => e.id === gate.estId);
      const lead = s.leads.find((l) => l.id === gate.leadId);
      const prevStatus = est?.status ?? "draft";
      const prevStage = lead?.stage ?? "New customer";
      s.updateEstimate(gate.estId, { status: "sent", age: 0 });
      const order: readonly string[] = STAGE_ORDER;
      const moved =
        lead && order.indexOf(prevStage) < order.indexOf("Quote Sent") && prevStage !== "Won";
      if (moved) s.moveLeadStage(gate.leadId, "Quote Sent");
      const note = s.addLeadNote(gate.leadId, {
        type: "text",
        from: "auto",
        when: "Just now",
        t: text,
      });
      return () => {
        const s2 = useAppStore.getState();
        s2.updateEstimate(gate.estId, { status: prevStatus });
        if (moved) s2.moveLeadStage(gate.leadId, prevStage);
        s2.removeLeadNote(gate.leadId, note.id ?? "");
      };
    }
    // plain-text — the owner's own words.
    const wasUnread = s.leads.find((l) => l.id === gate.leadId)?.unread ?? false;
    const note = s.addLeadNote(gate.leadId, { type: "text", from: "us", when: "Just now", t: text });
    if (wasUnread) s.updateLead(gate.leadId, { unread: false });
    const revertPlain = () => {
      const s2 = useAppStore.getState();
      s2.removeLeadNote(gate.leadId, note.id ?? "");
      if (wasUnread) s2.updateLead(gate.leadId, { unread: true });
    };
    dispatchOkSend(gate.leadId, text).catch(revertPlain);
    return revertPlain;
  }, []);

  const sendGate = useCallback(
    (entryId: number, gate: Gate, text: string) => {
      const undo = commitGate(gate, text);
      patchArtifact(entryId, {
        sent: { when: clockNow(), undo, expiresAt: Date.now() + UNDO_MS },
      } as Partial<Artifact>);
    },
    [commitGate, patchArtifact]
  );

  const undoEntry = useCallback(
    (entryId: number) => {
      const entry = entries.find((e) => e.id === entryId);
      const sent = entry && "sent" in entry.artifact ? entry.artifact.sent : undefined;
      if (!sent) return;
      sent.undo();
      patchArtifact(entryId, { sent: undefined } as Partial<Artifact>);
    },
    [entries, patchArtifact]
  );

  const sendRun = useCallback(
    (entryId: number) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry || entry.artifact.kind !== "run") return;
      const undos = entry.artifact.steps
        .map((st) => {
          if (st.item) return commitGate({ kind: "ok-item", item: st.item, text: st.draft }, st.draft);
          if (st.estSend) {
            return commitGate(
              { kind: "quote-send", ...st.estSend, text: st.estSend.smsText },
              st.estSend.smsText
            );
          }
          return null;
        })
        .filter((u): u is () => void => u !== null);
      patchArtifact(entryId, {
        sent: {
          when: clockNow(),
          undo: () => undos.forEach((u) => u()),
          expiresAt: Date.now() + UNDO_MS,
        },
      } as Partial<Artifact>);
    },
    [entries, commitGate, patchArtifact]
  );

  /**
   * Send a free-form utterance to the LLM agent. Immediately pushes a "thinking"
   * placeholder entry, then resolves it with the agent's response:
   * - completed   → ai-result artifact (text answer)
   * - needs_approval → ai-approval artifact (pending actions + transcript)
   * - refused     → confirm artifact (refusal note)
   * - error       → confirm artifact (actionable error message)
   */
  const runAgentInput = useCallback(
    async (request: string) => {
      const q = request.trim();
      if (!q) return;
      setOpen(true);
      setValue("");
      // Push the thinking placeholder immediately so the panel opens and shows activity.
      const thinkingId = ++_entryId;
      setEntries((prev) => [
        ...prev,
        { id: thinkingId, request: q, artifact: { kind: "ai-thinking" } as Artifact },
      ]);
      try {
        // Cap the carried transcript to avoid unbounded payload / context growth.
        // If the prior transcript exceeded the limit, start fresh and surface a notice.
        let carry: string | undefined;
        if (activeTranscript !== null) {
          if (activeTranscript.length <= MAX_TRANSCRIPT_CHARS) {
            carry = activeTranscript;
          } else {
            setActiveTranscript(null);
            setEntries((prev) => [
              ...prev,
              {
                id: ++_entryId,
                request: "",
                artifact: {
                  kind: "confirm",
                  lines: ["Started a fresh conversation — the previous context got long."],
                } as Artifact,
              },
            ]);
          }
        }
        // Pass the prior transcript when present so the agent remembers earlier context.
        const result = await agentRun.mutateAsync({
          message: q,
          transcript: carry,
        });
        // Persist the updated transcript for the next submit in this conversation.
        setActiveTranscript(result.transcript);
        setEntries((prev) =>
          prev.map((e) => {
            if (e.id !== thinkingId) return e;
            if (result.status === "completed") {
              return { ...e, artifact: { kind: "ai-result", text: result.text } as Artifact };
            }
            if (result.status === "needs_approval") {
              return {
                ...e,
                artifact: {
                  kind: "ai-approval",
                  pending: result.pending,
                  transcript: result.transcript,
                  assistantText: result.text,
                } as Artifact,
              };
            }
            // refused
            return {
              ...e,
              artifact: {
                kind: "confirm",
                lines: [result.text || "I can't do that."],
              } as Artifact,
            };
          })
        );
      } catch (err: unknown) {
        const isNotEnabled =
          err != null &&
          typeof err === "object" &&
          "data" in err &&
          (err as { data?: { code?: string } }).data?.code === "PRECONDITION_FAILED";
        const message = isNotEnabled
          ? "AI assistant isn't enabled — ask your admin to add the ANTHROPIC_API_KEY."
          : "Couldn't reach the AI assistant — please try again.";
        setEntries((prev) =>
          prev.map((e) =>
            e.id === thinkingId
              ? ({ ...e, artifact: { kind: "confirm", lines: [message] } as Artifact })
              : e
          )
        );
      }
    },
    [agentRun, activeTranscript]
  );

  /**
   * Approve or deny the pending agent actions in an `ai-approval` artifact.
   * Calls resume, then:
   * - another needs_approval → replace the entry with the new pending set (loop)
   * - completed → replace with ai-result + invalidate all v1 queries so the
   *   store refreshes to the persisted state (broad invalidate is safe here)
   * - refused → replace with a confirm artifact
   * - error → replace with a friendly confirm artifact
   *
   * No Undo is shown: agent writes are already persisted on the server — there
   * is no local rollback. Instead we settle to "✓ done" via the ai-result artifact.
   */
  const resumeApproval = useCallback(
    async (
      entryId: number,
      transcript: string,
      approvedToolUseIds: string[],
      deniedToolUseIds: string[],
    ) => {
      // Replace the approval card with a transient thinking state while waiting.
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, artifact: { kind: "ai-thinking" } as Artifact }
            : e,
        ),
      );
      try {
        const result = await agentResume.mutateAsync({
          transcript,
          approvedToolUseIds,
          deniedToolUseIds,
        });
        // Keep the transcript current through approval round-trips so a follow-up
        // question after an approved action still carries full context.
        setActiveTranscript(result.transcript);
        setEntries((prev) =>
          prev.map((e) => {
            if (e.id !== entryId) return e;
            if (result.status === "needs_approval") {
              return {
                ...e,
                artifact: {
                  kind: "ai-approval",
                  pending: result.pending,
                  transcript: result.transcript,
                  assistantText: result.text,
                } as Artifact,
              };
            }
            if (result.status === "completed") {
              // Invalidate all v1 queries so the store picks up the persisted writes.
              void utils.v1.invalidate();
              return { ...e, artifact: { kind: "ai-result", text: result.text } as Artifact };
            }
            // refused
            return {
              ...e,
              artifact: { kind: "confirm", lines: [result.text || "Action denied."] } as Artifact,
            };
          }),
        );
      } catch (err: unknown) {
        const isNotEnabled =
          err != null &&
          typeof err === "object" &&
          "data" in err &&
          (err as { data?: { code?: string } }).data?.code === "PRECONDITION_FAILED";
        const message = isNotEnabled
          ? "AI assistant isn't enabled — ask your admin to add the ANTHROPIC_API_KEY."
          : "Couldn't reach the AI assistant — please try again.";
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, artifact: { kind: "confirm", lines: [message] } as Artifact }
              : e,
          ),
        );
      }
    },
    [agentResume, utils],
  );

  const runInput = useCallback(
    (input: string) => {
      const q = input.trim();
      if (!q) return;
      void runAgentInput(q);
    },
    [runAgentInput]
  );

  // Tab: pre-fill the top row's primary verb as the input text so the user can
  // review it before submitting; the next Enter sends it through the agent.
  const tabComplete = useCallback(() => {
    const top = rows[0];
    const verb = top?.verbs[0];
    if (!top || !verb) return;
    const completed = `${firstName(top.lead.name).toLowerCase()} — ${verb.label}`;
    setValue(completed);
  }, [rows]);

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q) return;
    void runAgentInput(q);
  }, [value, runAgentInput]);

  // Named open/close helpers so callers never hold a raw setOpen reference.
  // All open→closed transitions MUST route through close() to guarantee the
  // transcript is reset. open() is the counterpart for the onFocus case.
  const open = useCallback(() => setOpen(true), []);

  const close = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
    // Reset the conversation thread so the next open starts fresh.
    setActiveTranscript(null);
  }, []);

  // Seed from elsewhere (Home's ask row): fill, focus, open.
  useEffect(() => {
    if (!cmdSeed) return;
    setValue(cmdSeed);
    setOpen(true);
    clearCmdSeed();
    inputRef.current?.focus();
  }, [cmdSeed, clearCmdSeed]);

  // Cmd+K / Ctrl+K focuses the bar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    /** Whether the counter panel is currently open. */
    open: openState,
    /** Open the counter panel (use this instead of raw setOpen to preserve encapsulation). */
    openPanel: open,
    /** Close the counter panel and reset the conversation transcript. Always use this — never setOpen(false) directly. */
    close,
    value,
    setValue,
    entries,
    rows,
    suggestions,
    inputRef,
    submit,
    tabComplete,
    runInput,
    sendGate,
    sendRun,
    undoEntry,
    openRef,
    resumeApproval,
    /** True while the LLM run mutation is in flight. */
    isThinking: agentRun.isPending,
    /** True while the resume mutation is in flight. */
    isResuming: agentResume.isPending,
  };
}

export type CounterApi = ReturnType<typeof useCounter>;
