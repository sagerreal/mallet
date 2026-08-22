"use client";

/**
 * features/artie/task-drawer.tsx
 * One task, opened from the board: what Artie has said so far, what it is waiting on, and the
 * two ways a person answers it — a reply, or a decision on a pending proposal. Never both, and not
 * merely "not at the same time": while anything is pending the reply box is not rendered AT ALL,
 * because the server refuses a typed reply in that state (see `TaskActions`, and
 * `assertNotAwaitingDecision` in the router). A control that cannot succeed is not offered.
 *
 * IN-FLOW, NOT A MODAL — no popover, no portal. It renders below the board using the sheet
 * grammar for its head (`.sheet-head` / `.sheet-rows`) and `.composer` (app/prototype.css:2550,
 * the class `thread-modal.tsx`/`team-chat-modal.tsx` reply rows already use) for the reply row —
 * NOT `.sheet-foot`, which every other usage in the repo is inside a `.modal` for; team-chat-modal
 * says outright it takes "deliberately NO `.sheet-foot`: the composer at the bottom already IS
 * the footer." `.composer` needs no override to work outside a modal.
 *
 * `.sheet-head` is written for a `.modal` ancestor: its padding/margin/position reference
 * `--modal-pad-x/y`, undefined outside one, so the whole declaration falls back to its initial
 * value (padding 0, `top` auto) rather than erroring — a real bug, not a crash. Same fix
 * `messages-inbox.tsx` applies for its own in-flow thread pane via a page-scoped CSS rule
 * (`.msg-pane-thread .sheet-head{...}`); done here as an inline override instead, since no new
 * CSS may be added.
 */

import { type CSSProperties, useState } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import { agoShort } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { ARTIE_COPY } from "./artie-copy";

type TaskGet = RouterOutputs["v1"]["agentTasks"]["get"];
type ArtieTaskDetail = TaskGet["task"];
type ArtieMessage = TaskGet["messages"][number];
type ArtiePending = TaskGet["pending"][number];

// See the file doc comment — the messages-inbox.tsx precedent for the same undefined-var trap.
const INFLOW_HEAD: CSSProperties = {
  position: "static",
  margin: 0,
  padding: "var(--space-4) var(--space-5) var(--space-3)",
};

interface TaskDrawerProps {
  readonly taskId: string;
  readonly onClose: () => void;
}

export function TaskDrawer({ taskId, onClose }: TaskDrawerProps) {
  const query = api.v1.agentTasks.get.useQuery({ taskId }, { refetchOnWindowFocus: true });

  if (query.isLoading) return <ListLoading />;
  if (query.isError || !query.data) {
    return (
      <LoadFailed
        noun={ARTIE_COPY.loadFailedTaskNoun}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  }

  return (
    <TaskDrawerBody
      taskId={taskId}
      task={query.data.task}
      messages={query.data.messages}
      pending={query.data.pending}
      onClose={onClose}
    />
  );
}

function ConversationTurns({ messages }: { messages: readonly ArtieMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="stack-3">
      {messages.map((m, i) => (
        <div key={i}>
          <p className="muted" style={{ fontSize: "var(--type-xs)" }}>{ARTIE_COPY.drawer.turnLabels[m.role]}</p>
          <p>{m.text}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * `resolvePending` (modules/ai/app/run-agent-turn.ts) executes nothing and appends no message
 * until EVERY pending id in the turn is decided in the SAME `reply` call — a lone per-item click
 * would redisplay the identical pending set with `task.version` silently bumped, which reads as a
 * bug rather than a wait state. So this is ONE shared pair, always sending every current pending
 * id together: "Approve"/"Not this one" when there is exactly one (approving "the group" IS
 * approving the one), "Approve all N"/"Not any of these" once there is more than one — the label
 * itself is what tells a shop owner these are decided as a group, not one at a time.
 */
function PendingList({
  pending,
  onDecide,
  busy,
}: {
  pending: readonly ArtiePending[];
  onDecide: (toolUseIds: readonly string[], decision: "approve" | "deny") => void;
  busy: boolean;
}) {
  const ids = pending.map((p) => p.toolUseId);
  const approveLabel =
    pending.length === 1 ? ARTIE_COPY.drawer.approve : `${ARTIE_COPY.drawer.approveAll} ${pending.length}`;
  const denyLabel = pending.length === 1 ? ARTIE_COPY.drawer.deny : ARTIE_COPY.drawer.denyAll;

  return (
    <div className="stack-3" style={{ marginTop: "var(--space-4)" }}>
      <p>{ARTIE_COPY.drawer.approvalLead}</p>
      {pending.map((p) => (
        <p key={p.toolUseId}>{p.summary}</p>
      ))}
      <div className="cardacts">
        <Button variant="approve" size="sm" onClick={() => onDecide(ids, "approve")} disabled={busy}>
          {approveLabel}
        </Button>
        <Button variant="quiet" size="sm" onClick={() => onDecide(ids, "deny")} disabled={busy}>
          {denyLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * The reply row (or, for a finished task, the fact stated plainly) and the secondary "Close this
 * task" action below it — `.sheet-secrow`/`.sheet-sec`, the same secondary-action row team-chat's
 * "Leave group" uses, and (like `.cardacts`) not modal-pad-dependent.
 */
function TaskActions({
  terminal,
  awaitingDecision,
  draft,
  onDraft,
  onSend,
  onCloseTask,
  busy,
}: {
  terminal: boolean;
  awaitingDecision: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  onCloseTask: () => void;
  busy: boolean;
}) {
  if (terminal) {
    return (
      <p className="muted" style={{ marginTop: "var(--space-4)" }}>
        {ARTIE_COPY.drawer.finished}
      </p>
    );
  }
  /**
   * NO REPLY BOX WHILE A PROPOSAL IS UNDECIDED, and this is a correctness guard, not a layout
   * preference.
   *
   * A transcript ending in an unanswered `tool_use` is a RESUME: the server's loop recognises that
   * exact shape and resolves it. Typing "yes, go ahead" instead of pressing Approve appends a user
   * message ahead of it, the loop stops recognising the resume, and the provider is handed a
   * `tool_use` with no matching `tool_result` — which it rejects for ever, on this request and on
   * every later wake. The task would be permanently unusable, reported as "temporarily
   * unavailable". The server refuses that reply outright (`assertNotAwaitingDecision`), so
   * rendering the box would only offer an action that cannot succeed.
   *
   * "Close this task" STAYS. It is not the refused action — it never touches the transcript, and it
   * is the owner's only way out of a proposal they want neither to approve nor to deny.
   */
  if (awaitingDecision) {
    return (
      <>
        <p className="muted" style={{ marginTop: "var(--space-4)" }}>
          {ARTIE_COPY.drawer.awaitingDecision}
        </p>
        <div className="sheet-secrow">
          <button type="button" className="sheet-sec" onClick={onCloseTask} disabled={busy}>
            {ARTIE_COPY.drawer.close}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="composer" style={{ marginTop: "var(--space-4)" }}>
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          aria-label={ARTIE_COPY.drawer.replyPlaceholder}
          placeholder={ARTIE_COPY.drawer.replyPlaceholder}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
        />
        <Button size="sm" onClick={onSend} disabled={busy || draft.trim() === ""}>
          {busy ? ARTIE_COPY.drawer.sending : ARTIE_COPY.drawer.send}
        </Button>
      </div>
      <div className="sheet-secrow">
        <button type="button" className="sheet-sec" onClick={onCloseTask} disabled={busy}>
          {ARTIE_COPY.drawer.close}
        </button>
      </div>
    </>
  );
}

/**
 * Terminal tasks (done/closed) get no reply box, no Approve/Deny, no "Close this task" — not to
 * dodge an LLM round trip (a disabled button would block the submit just as well), but because
 * the sheet head right above already states the status: showing live controls under a header that
 * says "Done" or "Closed" would contradict what the person just read. `TaskActions` states the
 * absence outright (`ARTIE_COPY.drawer.finished`) instead of leaving it to be inferred from
 * missing buttons.
 */
function isTerminalStatus(status: ArtieTaskDetail["status"]): boolean {
  return status === "done" || status === "closed";
}

/**
 * The mutation wiring, split out of TaskDrawerBody so the render stays skimmable. Every write
 * round-trips `task.version` — the version JUST READ in this render, never re-derived after a
 * local state change — so a CONFLICT means exactly what the router says it means: something else
 * (usually the background runner) wrote first.
 */
function useTaskDrawerActions(taskId: string, version: number) {
  const utils = api.useUtils();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reply = api.v1.agentTasks.reply.useMutation();
  const close = api.v1.agentTasks.close.useMutation();
  const busy = reply.isPending || close.isPending;

  const settle = (): void => {
    void utils.v1.agentTasks.get.invalidate({ taskId });
    void utils.v1.agentTasks.list.invalidate();
  };
  // The server's own sentence, shown unmodified — a CONFLICT means the runner (or another reply)
  // wrote first, and its message is authored for a person to read. ARTIE_COPY.conflict is only
  // the fallback for the (never-expected) case that message is blank.
  const onFail = (err: unknown): void => setError(userMessage(err, ARTIE_COPY.conflict));

  const decide = (toolUseIds: readonly string[], decision: "approve" | "deny"): void => {
    setError(null);
    reply.mutate(
      {
        taskId,
        version,
        ...(decision === "approve" ? { approvedToolUseIds: [...toolUseIds] } : { deniedToolUseIds: [...toolUseIds] }),
      },
      { onSuccess: settle, onError: onFail },
    );
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    reply.mutate({ taskId, version, text }, { onSuccess: () => { setDraft(""); settle(); }, onError: onFail });
  };

  const closeTask = (): void => {
    setError(null);
    close.mutate({ taskId, version }, { onSuccess: settle, onError: onFail });
  };

  return { draft, setDraft, error, busy, decide, send, closeTask };
}

function TaskDrawerBody({
  taskId,
  task,
  messages,
  pending,
  onClose,
}: {
  taskId: string;
  task: ArtieTaskDetail;
  messages: readonly ArtieMessage[];
  pending: readonly ArtiePending[];
  onClose: () => void;
}) {
  const { draft, setDraft, error, busy, decide, send, closeTask } = useTaskDrawerActions(taskId, task.version);
  const terminal = isTerminalStatus(task.status);
  // While anything is pending, the approval pair is the only transcript-touching action that can
  // succeed — see TaskActions for why a typed reply is refused rather than merely discouraged.
  const awaitingDecision = !terminal && pending.length > 0;

  return (
    <div className="stack-3">
      <Button variant="quiet" size="sm" onClick={onClose}>
        {ARTIE_COPY.drawer.back}
      </Button>
      <Card style={{ padding: 0 }}>
        <div className="sheet-head" style={INFLOW_HEAD}>
          <h2>{task.title}</h2>
          <div className="sheet-meta">
            <span>{ARTIE_COPY.columns[task.status]}</span>
            <span>· {agoShort(task.updatedAt)}</span>
          </div>
        </div>

        <div className="sheet-rows" style={{ padding: "var(--space-4) var(--space-5)" }}>
          <ConversationTurns messages={messages} />
          {awaitingDecision ? <PendingList pending={pending} onDecide={decide} busy={busy} /> : null}
          {error ? (
            <p role="alert" style={{ color: "var(--red)" }}>
              {error}
            </p>
          ) : null}
          <TaskActions
            terminal={terminal}
            awaitingDecision={awaitingDecision}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            onCloseTask={closeTask}
            busy={busy}
          />
        </div>
      </Card>
    </div>
  );
}
