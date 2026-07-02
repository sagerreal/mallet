"use client";
import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";

export type ChatItem = { role: "user" | "assistant"; text: string };
export type PendingAction = { toolUseId: string; tool: string; argsJson: string };

// One agent conversation. Approval is ALL-OR-NOTHING per pause (the loop typically pauses on a
// single action); the transcript is opaque server state we just round-trip.
export function useAssistant() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = api.v1.ai.run.useMutation();
  const resume = api.v1.ai.resume.useMutation();
  const busy = run.isPending || resume.isPending;

  const absorb = (result: { status: string; text: string; pending: PendingAction[]; transcript: string }) => {
    setTranscript(result.transcript);
    setPending(result.status === "needs_approval" ? result.pending : []);
    const text = result.status === "refused" ? "I can't help with that request." : (result.text || "Done.");
    if (text) setItems((prev) => [...prev, { role: "assistant", text }]);
  };
  const fail = (err: unknown) => setError(userMessage(err));

  const send = (message: string) => {
    setError(null);
    setItems((prev) => [...prev, { role: "user", text: message }]);
    run.mutate({ message }, { onSuccess: absorb, onError: fail });
  };

  const resolveApprovals = (approved: boolean) => {
    if (!transcript) return;
    setError(null);
    const snapshot = pending;
    const ids = pending.map((p) => p.toolUseId);
    setPending([]);
    resume.mutate(
      { transcript, approvedToolUseIds: approved ? ids : [], deniedToolUseIds: approved ? [] : ids },
      { onSuccess: absorb, onError: (err) => { setPending(snapshot); fail(err); } },
    );
  };

  return { items, pending, busy, error, send, approveAll: () => resolveApprovals(true), denyAll: () => resolveApprovals(false) };
}
