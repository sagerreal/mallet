"use client";

/**
 * features/artie/task-drawer.tsx
 * One task, opened from the board: what Artie has said so far, what it is waiting on, and the
 * two ways a person answers it — a reply, or a decision on a pending proposal (never both on the
 * same turn, per the router's `reply` doc comment).
 *
 * IN-FLOW, NOT A MODAL — no popover, no portal. It renders below the board using the sheet
 * grammar (`.sheet-head` / `.sheet-rows` / `.sheet-foot`), the same frame the customer/team
 * thread panes use for an in-page (non-modal) conversation view.
 *
 * `.sheet-head`/`.sheet-foot` are written for a `.modal` ancestor: their padding/margin/position
 * reference `--modal-pad-x/y`, which is undefined outside one, so the whole declaration falls
 * back to its initial value (padding 0, `top`/`bottom` auto) rather than erroring — a real bug,
 * not a crash. `messages-inbox.tsx` fixes this the same way for its own in-flow thread pane, via
 * a page-scoped CSS rule; done here as inline overrides instead, since no new CSS may be added.
 */

import { type CSSProperties, useState } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import { agoShort } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { ARTIE_COPY } from "./artie-copy";

type TaskGet = RouterOutputs["v1"]["agentTasks"]["get"];
type ArtieTaskDetail = TaskGet["task"];
type ArtieMessage = TaskGet["messages"][number];
type ArtiePending = TaskGet["pending"][number];

const INFLOW_HEAD: CSSProperties = {
  position: "static",
  margin: 0,
  padding: "var(--space-4) var(--space-5) var(--space-3)",
};
const INFLOW_FOOT: CSSProperties = {
  position: "static",
  margin: 0,
  padding: "var(--space-3) var(--space-5)",
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
          <p className="muted" style={{ fontSize: "var(--type-xs)" }}>{m.role === "user" ? "You" : "Artie"}</p>
          <p>{m.text}</p>
        </div>
      ))}
    </div>
  );
}

function PendingList({
  pending,
  onDecide,
  busy,
}: {
  pending: readonly ArtiePending[];
  onDecide: (toolUseId: string, decision: "approve" | "deny") => void;
  busy: boolean;
}) {
  return (
    <div className="stack-3" style={{ marginTop: "var(--space-4)" }}>
      <p>{ARTIE_COPY.drawer.approvalLead}</p>
      {pending.map((p) => (
        <div key={p.toolUseId} className="stack-2">
          <p>{p.summary}</p>
          <div className="cardacts">
            <Button variant="approve" size="sm" onClick={() => onDecide(p.toolUseId, "approve")} disabled={busy}>
              {ARTIE_COPY.drawer.approve}
            </Button>
            <Button variant="quiet" size="sm" onClick={() => onDecide(p.toolUseId, "deny")} disabled={busy}>
              {ARTIE_COPY.drawer.deny}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplyFooter({
  draft,
  onDraft,
  onSend,
  onCloseTask,
  busy,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  onCloseTask: () => void;
  busy: boolean;
}) {
  return (
    <div className="stack-2">
      <Field label={ARTIE_COPY.drawer.replyPlaceholder}>
        <textarea value={draft} onChange={(e) => onDraft(e.target.value)} rows={2} disabled={busy} />
      </Field>
      <div className="cardacts">
        <Button size="sm" onClick={onSend} disabled={busy || draft.trim() === ""}>
          {busy ? ARTIE_COPY.drawer.sending : ARTIE_COPY.drawer.send}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCloseTask} disabled={busy}>
          {ARTIE_COPY.drawer.close}
        </Button>
      </div>
    </div>
  );
}

/**
 * Terminal tasks (done/closed) get no composer: the domain refuses `close()` on either, and
 * `reply()` would run a wasted turn only to lose the race at settle time (its `isTerminal()`
 * check discards the transition) — see agent-task.ts. Hiding the controls avoids both the wasted
 * LLM round trip and a CONFLICT sentence that would be misleading for a task nobody raced with.
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

  const decide = (toolUseId: string, decision: "approve" | "deny"): void => {
    setError(null);
    reply.mutate(
      { taskId, version, ...(decision === "approve" ? { approvedToolUseIds: [toolUseId] } : { deniedToolUseIds: [toolUseId] }) },
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
          {!terminal && pending.length > 0 ? <PendingList pending={pending} onDecide={decide} busy={busy} /> : null}
          {error ? (
            <p role="alert" style={{ color: "var(--red)" }}>
              {error}
            </p>
          ) : null}
        </div>

        {!terminal ? (
          <div className="sheet-foot" style={INFLOW_FOOT}>
            <ReplyFooter draft={draft} onDraft={setDraft} onSend={send} onCloseTask={closeTask} busy={busy} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
