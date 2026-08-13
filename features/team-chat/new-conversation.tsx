"use client";

/**
 * features/team-chat/new-conversation.tsx
 * Start a DM or a group, in flow under the button that opened it.
 *
 * One panel does both: pick one person and it is a DM, pick several and it asks for a name. The
 * shape follows the selection rather than making somebody choose a type before they have chosen
 * a person.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import type { TeamThreadDTO } from "@mallet/team-chat";

export interface NewConversationProps {
  readonly onDone: () => void;
  /** Hands the caller the new thread so the page can open it in the reading pane at once. */
  readonly onStarted: (thread: TeamThreadDTO) => void;
}

export function NewConversation({ onDone, onStarted }: NewConversationProps) {
  const roster = api.v1.teamChat.roster.useQuery(undefined, { staleTime: 60_000 });
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (userId: string): void =>
    setPicked((prev) => (prev.includes(userId) ? prev.filter((p) => p !== userId) : [...prev, userId]));

  const isGroup = picked.length > 1;

  async function start(): Promise<void> {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { threadId } = isGroup
        ? await trpcVanilla.v1.teamChat.createGroup.mutate({ title: title.trim(), userIds: picked })
        : await trpcVanilla.v1.teamChat.startDm.mutate({ userId: picked[0]! });
      onDone();
      // Hand back a row shaped like the list's own, so the thread opens immediately instead of
      // waiting on a refetch. The poll reconciles it a beat later.
      const members = (roster.data ?? [])
        .filter((r) => picked.includes(r.userId))
        .map((r) => ({ userId: r.userId, name: r.name }));
      onStarted({
        id: threadId,
        kind: isGroup ? "group" : "dm",
        title: isGroup ? title.trim() : null,
        lastMessageAt: new Date().toISOString(),
        lastBody: "",
        lastAuthorUserId: null,
        lastHadAttachment: false,
        unreadCount: 0,
        members,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't start that conversation.");
    } finally {
      setBusy(false);
    }
  }

  if (roster.isLoading) return <ListLoading label="Loading your team…" />;
  if (roster.isError) {
    return <LoadFailed noun="teammates" onRetry={() => void roster.refetch()} retrying={roster.isRefetching} />;
  }
  if ((roster.data ?? []).length === 0) {
    return (
      <div className="empty-att">
        You&rsquo;re the only person in this shop — invite your crew in Settings first.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "var(--space-4)", marginBottom: "var(--space-3)" }}>
      <div className="sheet-worklab">Who</div>
      <div className="who-chips" role="group" aria-label="Pick teammates">
        {(roster.data ?? []).map((r) => (
          <button
            key={r.userId}
            type="button"
            className={`chip${picked.includes(r.userId) ? " sel" : ""}`}
            aria-pressed={picked.includes(r.userId)}
            onClick={() => toggle(r.userId)}
          >
            {picked.includes(r.userId) ? <span aria-hidden="true">✓ </span> : null}
            {r.name}
          </button>
        ))}
      </div>

      {isGroup ? (
        <label className="auth-field" style={{ marginBottom: "var(--space-3)" }}>
          <span>Group name</span>
          <input
            className="auth-input"
            value={title}
            maxLength={80}
            placeholder="Friday van checks"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
      ) : null}

      {error ? (
        <p className="muted" style={{ color: "var(--red)", fontSize: "var(--type-sm)" }} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn primary"
        disabled={busy || picked.length === 0 || (isGroup && title.trim().length === 0)}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : isGroup ? `Start group (${picked.length})` : "Start message"}
      </button>
    </div>
  );
}
