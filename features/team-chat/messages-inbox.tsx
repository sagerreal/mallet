"use client";

/**
 * features/team-chat/messages-inbox.tsx
 * The Messages page: one inbox, two kinds of conversation.
 *
 * CUSTOMERS go out over the business number and a customer reads them. TEAM conversations stay
 * in the shop. That distinction is the whole design: a segmented control chooses the mode, and
 * internal rows and threads sit on MANILA — the app's own work-order paper stock — so an
 * internal conversation is unmistakable even glanced at sideways, or screenshotted alone.
 *
 * Layout is two-pane on a desktop (the list stays put while you read a thread) and one pane at a
 * time on a phone, where the thread takes the screen. No overlay either way: this replaces the
 * small centred modal the page used to open.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { shortWhen } from "@/lib/format";
import { pressable } from "@/lib/a11y";
import { hasPhone, ADD_PHONE_TITLE } from "@/lib/phone";
import { inboxQueryOptions } from "@/features/field/inbox-query-options";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { CustomerThreadPane } from "@/components/modals/thread-modal";
import { TeamChatPane } from "@/components/modals/team-chat-modal";
import { NewConversation } from "./new-conversation";
import { initialsOf, threadTitle, previewOf } from "./thread-labels";
import type { TeamThreadDTO } from "@mallet/team-chat";
import type { RouterOutputs } from "@/lib/trpc/client";

type CustomerRow = RouterOutputs["v1"]["messaging"]["listConversations"][number];

/** The slice of a React Query result these lists actually read. */
interface ListQuery<T> {
  readonly data: T[] | undefined;
  readonly isFetched: boolean;
  readonly isError: boolean;
  readonly isRefetching: boolean;
  readonly refetch: () => unknown;
}

type Mode = "customers" | "team";

/** What the right pane is showing. Null = nothing picked yet. */
type Selection =
  | { kind: "customer"; leadId: string; name: string; phone: string | null }
  | { kind: "team"; thread: TeamThreadDTO }
  | null;

interface MessagesInboxProps {
  /** Customer texts are owner/office only — a tech gets the Team side alone. */
  readonly canSeeCustomers: boolean;
  readonly meUserId: string | undefined;
}

export function MessagesInbox({ canSeeCustomers, meUserId }: MessagesInboxProps) {
  // A tech has no customer inbox to start on, so the control opens where they can actually work.
  const [mode, setMode] = useState<Mode>(canSeeCustomers ? "customers" : "team");
  const [selected, setSelected] = useState<Selection>(null);
  const [composing, setComposing] = useState(false);

  const customers = api.v1.messaging.listConversations.useQuery(undefined, {
    ...inboxQueryOptions,
    enabled: canSeeCustomers,
  });
  const teams = api.v1.teamChat.listThreads.useQuery(undefined, inboxQueryOptions);

  const teamUnread = (teams.data ?? []).reduce((n, t) => n + t.unreadCount, 0);
  const customerUnread = (customers.data ?? []).filter((c) => c.unread).length;

  const pick = (next: Selection): void => {
    setSelected(next);
    setComposing(false);
  };

  return (
    <div className={`msg-shell${selected ? " reading" : ""}`}>
      <div className="msg-pane-list">
        <div className="msg-modes">
          {canSeeCustomers ? (
            <div className="segctl" role="group" aria-label="Which conversations">
            <button
              type="button"
              className={mode === "customers" ? "on" : ""}
              aria-pressed={mode === "customers"}
              onClick={() => {
                setMode("customers");
                setSelected(null);
              }}
            >
              Customers
              {customerUnread > 0 ? <span className="segctl-n">{customerUnread}</span> : null}
            </button>
            <button
              type="button"
              className={mode === "team" ? "on" : ""}
              aria-pressed={mode === "team"}
              onClick={() => {
                setMode("team");
                setSelected(null);
              }}
            >
              Team
                {teamUnread > 0 ? <span className="segctl-n">{teamUnread}</span> : null}
              </button>
            </div>
          ) : null}
          {mode === "team" ? (
            <button
              type="button"
              className="btn primary sm"
              onClick={() => setComposing(!composing)}
              aria-expanded={composing}
            >
              {composing ? "Cancel" : "+ New message"}
            </button>
          ) : null}
        </div>

        {mode === "customers" ? (
          <CustomerList query={customers} selectedId={selected?.kind === "customer" ? selected.leadId : null} onPick={pick} />
        ) : (
          <TeamList
            query={teams}
            meUserId={meUserId}
            composing={composing}
            onCompose={setComposing}
            selectedId={selected?.kind === "team" ? selected.thread.id : null}
            onPick={pick}
          />
        )}
      </div>

      <div className="msg-pane-thread">
        {selected !== null ? (
          // The thread covers the screen on a phone, so it needs its own way back. Hidden on a
          // desktop, where the list never went anywhere.
          <button type="button" className="msg-back" onClick={() => setSelected(null)}>
            ‹ All conversations
          </button>
        ) : null}
        {selected === null ? (
          // Desktop only — on a phone the list occupies the screen until something is picked.
          <div className="msg-nothread">
            <p className="muted">Pick a conversation to read it.</p>
          </div>
        ) : selected.kind === "customer" ? (
          <CustomerThreadPane
            key={selected.leadId}
            leadId={selected.leadId}
            paramName={selected.name}
            paramPhone={selected.phone ?? undefined}
            onClose={() => setSelected(null)}
          />
        ) : (
          <TeamChatPane
            key={selected.thread.id}
            threadId={selected.thread.id}
            kind={selected.thread.kind}
            title={threadTitle(selected.thread, meUserId)}
            subtitle={
              selected.thread.kind === "group"
                ? `${selected.thread.members.length} people · never seen by a customer`
                : "Internal — never seen by a customer"
            }
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

// ── customers ────────────────────────────────────────────────────────────────────────────────

function CustomerList({
  query,
  selectedId,
  onPick,
}: {
  readonly query: ListQuery<CustomerRow>;
  readonly selectedId: string | null;
  readonly onPick: (s: Selection) => void;
}) {
  const listState = { isFetched: query.isFetched, isError: query.isError, count: query.data?.length ?? 0 };

  if (isFirstLoad(listState)) return <ListLoading label="Loading conversations…" />;
  if (shouldShowLoadFailed(listState)) {
    return <LoadFailed noun="conversations" onRetry={() => void query.refetch()} retrying={query.isRefetching} />;
  }
  if (shouldShowFirstRun(listState)) {
    return (
      <div className="empty-att">
        No customer messages yet — they&rsquo;ll appear here when a customer texts your business number.
      </div>
    );
  }

  return (
    <div className="rows">
      {(query.data ?? []).map((c) => {
        const reachable = hasPhone({ phone: c.phone });
        const open = (): void =>
          onPick({ kind: "customer", leadId: c.leadId, name: c.leadName, phone: c.phone });
        return (
          <div
            key={c.leadId}
            className={`msg-row${c.unread ? " unread" : ""}${selectedId === c.leadId ? " sel" : ""}`}
            aria-disabled={!reachable || undefined}
            title={!reachable ? ADD_PHONE_TITLE : undefined}
            onClick={reachable ? open : undefined}
            {...(reachable ? pressable(open) : {})}
          >
            <span className="javatar msg-av">{initialsOf(c.leadName)}</span>
            <div className="msg-main">
              <div className="msg-nm">
                <span className="msg-nmtxt">{c.leadName}</span>
                {c.unread ? <span className="msg-dot" /> : null}
              </div>
              <div className="msg-snip">
                {c.lastDirection === "outbound" ? "You: " : ""}
                {c.lastBody}
              </div>
            </div>
            <span className="msg-tm">{shortWhen(c.lastAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── team ─────────────────────────────────────────────────────────────────────────────────────

function TeamList({
  query,
  meUserId,
  composing,
  onCompose,
  selectedId,
  onPick,
}: {
  readonly query: ListQuery<TeamThreadDTO>;
  readonly meUserId: string | undefined;
  readonly composing: boolean;
  readonly onCompose: (v: boolean) => void;
  readonly selectedId: string | null;
  readonly onPick: (s: Selection) => void;
}) {
  const listState = { isFetched: query.isFetched, isError: query.isError, count: query.data?.length ?? 0 };

  return (
    <>
      {/* In flow, under the control that opened it — never a floating panel. */}
      {composing ? (
        <NewConversation
          onDone={() => onCompose(false)}
          onStarted={(thread) => onPick({ kind: "team", thread })}
        />
      ) : null}

      {isFirstLoad(listState) ? (
        <ListLoading label="Loading conversations…" />
      ) : shouldShowLoadFailed(listState) ? (
        <LoadFailed noun="conversations" onRetry={() => void query.refetch()} retrying={query.isRefetching} />
      ) : shouldShowFirstRun(listState) ? (
        <div className="empty-att">
          No team conversations yet — start one with <b>+ New message</b>.
        </div>
      ) : (
        <div className="rows">
          {(query.data ?? []).map((t) => {
            const name = threadTitle(t, meUserId);
            const unread = t.unreadCount > 0;
            const open = (): void => onPick({ kind: "team", thread: t });
            return (
              <div
                key={t.id}
                // `internal` is the manila treatment — the visual fact that this never leaves the shop.
                className={`msg-row internal${unread ? " unread" : ""}${selectedId === t.id ? " sel" : ""}`}
                onClick={open}
                {...pressable(open)}
              >
                <span className="javatar msg-av">
                  {t.kind === "group" ? String(t.members.length) : initialsOf(name)}
                </span>
                <div className="msg-main">
                  <div className="msg-nm">
                    <span className="msg-nmtxt">{name}</span>
                    <span className="msg-tag">Team</span>
                    {unread ? <span className="msg-badge">{t.unreadCount}</span> : null}
                  </div>
                  <div className="msg-snip">{previewOf(t, meUserId)}</div>
                </div>
                <span className="msg-tm">{shortWhen(t.lastMessageAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
