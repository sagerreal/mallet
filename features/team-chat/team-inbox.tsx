"use client";

/**
 * features/team-chat/team-inbox.tsx
 * The staff side of the Messages page: my conversations, and the way to start a new one.
 *
 * Renders in the SAME `.msg-row` register as the customer inbox above it, so one page reads as
 * one inbox with two kinds of conversation rather than two bolted-together widgets. Available to
 * every role — a crew talking to each other is not an office feature.
 */

import { useState } from "react";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { shortWhen } from "@/lib/format";
import { pressable } from "@/lib/a11y";
import { inboxQueryOptions } from "@/features/field/inbox-query-options";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import type { TeamThreadDTO } from "@mallet/team-chat";

/** Initials for the row avatar. Splits on spaces, dots, @ and dashes so an email works too. */
function initialsOf(nameOrEmail: string): string {
  const parts = (nameOrEmail || "?").split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.map((p) => p[0] ?? "").join("");
  return (letters.slice(0, 2) || "??").toUpperCase();
}

/**
 * What a thread is CALLED to the person reading it. A group has its own name; a DM is named after
 * the other person, which is why members ride the inbox row (the field shell has no roster).
 */
function threadTitle(t: TeamThreadDTO, meUserId: string | undefined): string {
  if (t.kind === "group") return t.title ?? "Group";
  const other = t.members.find((m) => m.userId !== meUserId);
  return other?.name ?? "Teammate";
}

/** The second line: who said what, or that a photo came through. */
function preview(t: TeamThreadDTO, meUserId: string | undefined): string {
  const mine = t.lastAuthorUserId && t.lastAuthorUserId === meUserId;
  const prefix = mine ? "You: " : "";
  const body = t.lastBody.trim();
  const text = body || (t.lastHadAttachment ? "Photo" : "No messages yet");
  const full = `${prefix}${text}`;
  return full.length > 72 ? `${full.slice(0, 72)}…` : full;
}

interface TeamInboxProps {
  /** The viewer, so a DM can be named after the OTHER person and "You:" is honest. */
  readonly meUserId: string | undefined;
}

export function TeamInbox({ meUserId }: TeamInboxProps) {
  const openModal = useOpenModal();
  const [composing, setComposing] = useState(false);

  const threads = api.v1.teamChat.listThreads.useQuery(undefined, inboxQueryOptions);
  const listState = {
    isFetched: threads.isFetched,
    isError: threads.isError,
    count: threads.data?.length ?? 0,
  };

  const open = (t: TeamThreadDTO): void => {
    openModal(MODAL.TEAM_CHAT, {
      threadId: t.id,
      kind: t.kind,
      title: threadTitle(t, meUserId),
      subtitle:
        t.kind === "group"
          ? `${t.members.length} people · internal`
          : "Internal — the customer never sees this",
    });
  };

  return (
    <>
      <div className="toolbar">
        <span className="muted" style={{ fontWeight: 650 }}>
          Team
        </span>
        <button
          type="button"
          className="btn primary sm"
          style={{ marginLeft: "auto" }}
          onClick={() => setComposing((v) => !v)}
          aria-expanded={composing}
        >
          {composing ? "Cancel" : "+ New message"}
        </button>
      </div>

      {/* In-flow, under the control that opened it — no floating panel. */}
      {composing ? <NewConversation onDone={() => setComposing(false)} /> : null}

      {isFirstLoad(listState) ? (
        <ListLoading label="Loading conversations…" />
      ) : shouldShowLoadFailed(listState) ? (
        <LoadFailed
          noun="conversations"
          onRetry={() => void threads.refetch()}
          retrying={threads.isRefetching}
        />
      ) : shouldShowFirstRun(listState) ? (
        // Not a FirstRunEmptyState: this sits BELOW a populated customer inbox on a shared page,
        // so the full-page invitation would fight the list above it. One line, with the action
        // already on screen in the toolbar.
        <div className="empty-att">
          No team conversations yet — start one with <b>+ New message</b>.
        </div>
      ) : (
        (threads.data ?? []).map((t) => {
          const name = threadTitle(t, meUserId);
          const unread = t.unreadCount > 0;
          return (
            <div
              key={t.id}
              className={`msg-row${unread ? " unread" : ""}`}
              onClick={() => open(t)}
              {...pressable(() => open(t))}
            >
              <span
                className="javatar"
                style={{
                  width: 38,
                  height: 38,
                  fontSize: "var(--type-base)",
                  background: "var(--green-100)",
                  color: "var(--ink)",
                }}
              >
                {t.kind === "group" ? `${t.members.length}` : initialsOf(name)}
              </span>
              <div className="msg-main">
                <div className="msg-nm">
                  {name}
                  {t.kind === "group" ? (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      · {t.members.length} people
                    </span>
                  ) : null}
                  {unread ? (
                    <span className="pill blue" style={{ fontSize: "var(--type-xs)" }}>
                      {t.unreadCount}
                    </span>
                  ) : null}
                </div>
                <div className="msg-snip">{preview(t, meUserId)}</div>
              </div>
              <span className="msg-tm">{shortWhen(t.lastMessageAt)}</span>
            </div>
          );
        })
      )}
    </>
  );
}

/**
 * Start a DM or a group, in flow. One panel does both: pick one person and it is a DM, pick
 * several and it asks for a name — the shape follows what you selected rather than making you
 * choose a type up front.
 */
function NewConversation({ onDone }: { readonly onDone: () => void }) {
  const openModal = useOpenModal();
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
      openModal(MODAL.TEAM_CHAT, {
        threadId,
        kind: isGroup ? "group" : "dm",
        title: isGroup ? title.trim() : (roster.data?.find((r) => r.userId === picked[0])?.name ?? "Teammate"),
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
      <div className="jh-filters" style={{ marginBottom: "var(--space-3)" }} role="group" aria-label="Pick teammates">
        {(roster.data ?? []).map((r) => (
          <button
            key={r.userId}
            type="button"
            className={`chip${picked.includes(r.userId) ? " on" : ""}`}
            aria-pressed={picked.includes(r.userId)}
            onClick={() => toggle(r.userId)}
          >
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
