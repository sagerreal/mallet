"use client";

/**
 * components/modals/team-chat-modal.tsx
 * A staff conversation — a DM or a group — with photo attachments.
 *
 * Sheet grammar (frame only): the thread name and its people live in a sticky `.sheet-head`. There
 * is deliberately NO `.sheet-foot`: the composer at the bottom already IS the footer, and promoting
 * Send to a `.sheet-pri` would duplicate it. Same exemption the customer thread modal takes.
 *
 * Bubbles reuse the customer thread's `.msg`/`.bub`/`.meta` classes verbatim, so a staff chat and
 * a customer text read as one product rather than two chat widgets.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { shortWhen } from "@/lib/format";
import { userMessage } from "@/lib/trpc/error-map";
import { uploadChatPhoto } from "@/lib/store/upload-chat-photo";
import { ChatImage } from "@/components/shared/chat-image";

/** While a thread is open it polls, matching the customer thread's cadence exactly. */
const THREAD_POLL_MS = 10_000;

interface Optimistic {
  readonly id: string;
  readonly body: string;
  /** A local object URL so the sender sees their photo immediately, before the round trip. */
  readonly previewUrl: string | null;
}

/** The composer's own failure text. Server sentences pass through; the rest get plain words. */
function friendlyError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "data" in err
      ? ((err as { data?: { code?: string } }).data?.code ?? "")
      : "";
  if (code === "PRECONDITION_FAILED") return userMessage(err, "Photos aren't set up yet.");
  if (code === "NOT_FOUND") return "You're no longer in this conversation.";
  if (code === "BAD_REQUEST") return userMessage(err, "That message couldn't be sent.");
  return "Couldn't send — try again.";
}

/**
 * The staff conversation itself, independent of how it is presented — the Messages page renders
 * it in its right pane, the modal renders it as a drill-in. The row supplies the name and people
 * because the field shell has no roster to look them up in.
 */
export interface TeamChatPaneProps {
  readonly threadId: string | undefined;
  readonly title?: string;
  readonly subtitle?: string;
  readonly kind?: string;
  readonly onClose: () => void;
}

export function TeamChatPane({
  threadId,
  title: titleProp,
  subtitle,
  kind,
  onClose: close,
}: TeamChatPaneProps) {
  const title = titleProp ?? "Conversation";
  // Only a GROUP can be left. Leaving a 1:1 is not a thing a person means to do — and the
  // conversation reopens the moment either of you messages the other anyway.
  const isGroup = kind === "group";

  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<Optimistic[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = api.useUtils();

  const { data: messages, isLoading } = api.v1.teamChat.listMessages.useQuery(
    { threadId: threadId ?? "" },
    {
      enabled: Boolean(threadId),
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchInterval: threadId ? THREAD_POLL_MS : false,
    },
  );

  // Opening clears MY badge only — the cursor is per-person, so a group stays unread for everyone
  // who has not looked. Invalidate the inbox so the list's count catches up.
  useEffect(() => {
    if (!threadId) return;
    trpcVanilla.v1.teamChat.markRead
      .mutate({ threadId })
      .then(() => utils.v1.teamChat.listThreads.invalidate())
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") console.error("[teamChat.markRead]", err);
      });
    // utils is a stable ref from api.useUtils(); threadId is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Keep the thread pinned to the newest message.
  const rowCount = (messages?.length ?? 0) + optimistic.length;
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [rowCount]);

  // Revoke the object URLs the optimistic previews hold, so an open thread does not leak blobs.
  useEffect(
    () => () => {
      for (const o of optimistic) if (o.previewUrl) URL.revokeObjectURL(o.previewUrl);
    },
    [optimistic],
  );

  if (!threadId) return null;
  // Captured after the guard: `send`/`attach` are hoisted declarations, so they do not inherit
  // the narrowing from the early return above.
  const tid: string = threadId;

  async function send(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    setSendError(null);
    setDraft("");
    const tempId = `opt-${Date.now()}`;
    setOptimistic((prev) => [...prev, { id: tempId, body, previewUrl: null }]);
    try {
      await trpcVanilla.v1.teamChat.send.mutate({ threadId: tid, body });
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      await Promise.all([
        utils.v1.teamChat.listMessages.invalidate({ threadId: tid }),
        utils.v1.teamChat.listThreads.invalidate(),
      ]);
    } catch (err: unknown) {
      // Restore the draft so the words are not lost, and say why.
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      setDraft(body);
      setSendError(friendlyError(err));
    }
  }

  async function attach(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    // Clear the input so picking the SAME file twice still fires a change event.
    e.target.value = "";
    if (!file) return;

    setSendError(null);
    setUploading(true);
    // The caption in the box rides along with the photo — one message, not two.
    const caption = draft.trim();
    const previewUrl = URL.createObjectURL(file);
    const tempId = `opt-${Date.now()}`;
    setOptimistic((prev) => [...prev, { id: tempId, body: caption, previewUrl }]);
    setDraft("");

    try {
      const attachment = await uploadChatPhoto(tid, file);
      await trpcVanilla.v1.teamChat.send.mutate({ threadId: tid, body: caption, attachment });
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      URL.revokeObjectURL(previewUrl);
      await Promise.all([
        utils.v1.teamChat.listMessages.invalidate({ threadId: tid }),
        utils.v1.teamChat.listThreads.invalidate(),
      ]);
    } catch (err: unknown) {
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      URL.revokeObjectURL(previewUrl);
      setDraft(caption);
      setSendError(friendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  async function leave(): Promise<void> {
    try {
      await trpcVanilla.v1.teamChat.leave.mutate({ threadId: tid });
      await utils.v1.teamChat.listThreads.invalidate();
      close();
    } catch (err: unknown) {
      setSendError(friendlyError(err));
    }
  }

  return (
    <>
      {/* Manila ground + a stamp: an internal conversation must be unmistakable mid-scroll,
          not only when you read the subtitle. */}
      <div className="sheet-head internal">
        <h2>{title}</h2>
        <div className="sheet-meta">
          <span className="thread-stamp">Internal</span>
          <span>{subtitle ?? "Never seen by a customer"}</span>
        </div>
      </div>

      <div className="thread internal" ref={scrollRef}>
        {isLoading ? (
          <div className="thread-empty">
            <div className="thread-empty-sub">Loading…</div>
          </div>
        ) : (messages?.length ?? 0) + optimistic.length > 0 ? (
          <>
            {(messages ?? []).map((m) => (
              <div key={m.id} className={`msg ${m.isMine ? "us" : "them"}`}>
                {m.attachment ? (
                  <ChatImage
                    threadId={tid}
                    path={m.attachment.path}
                    alt={m.body.trim() || `Attachment from ${m.senderName ?? "a teammate"}`}
                  />
                ) : null}
                {m.body ? <div className="bub">{m.body}</div> : null}
                <div className="meta">
                  {m.isMine ? "" : `${m.senderName ?? "Teammate"} · `}
                  {shortWhen(m.createdAt)}
                </div>
              </div>
            ))}
            {optimistic.map((o) => (
              <div key={o.id} className="msg us">
                {o.previewUrl ? (
                  <img
                    src={o.previewUrl}
                    alt="Attachment being sent"
                    className="chat-photo"
                  />
                ) : null}
                {o.body ? <div className="bub">{o.body}</div> : null}
                <div className="meta">{uploading ? "Sending photo…" : "Sending…"}</div>
              </div>
            ))}
          </>
        ) : (
          <div className="thread-empty">
            <div className="thread-empty-title">No messages yet</div>
            <div className="thread-empty-sub">Send a message or a photo to start.</div>
          </div>
        )}
      </div>

      {sendError ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)", color: "var(--red)", padding: "var(--space-1) 0" }} role="alert">
          {sendError}
        </div>
      ) : null}

      <div className="composer">
        {/* The camera on a phone, the file picker on a desktop — one control, no native plugin
            (the same input the job-photo surfaces use). */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void attach(e)}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="btn quiet"
          disabled={uploading}
          aria-label="Attach a photo"
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "…" : "Photo"}
        </button>
        <input
          value={draft}
          aria-label="Message"
          placeholder="Message your team…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button className="btn primary" onClick={() => void send()}>
          Send
        </button>
      </div>

      {isGroup ? (
        <div className="sheet-secrow">
          <button type="button" className="sheet-sec" onClick={() => void leave()}>
            Leave group
          </button>
        </div>
      ) : null}
    </>
  );
}

/** The drill-in presentation: reads the modal params and renders the pane. */
export function TeamChatModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  return (
    <TeamChatPane
      threadId={activeModal?.params?.threadId as string | undefined}
      title={activeModal?.params?.title as string | undefined}
      subtitle={activeModal?.params?.subtitle as string | undefined}
      kind={activeModal?.params?.kind as string | undefined}
      onClose={close}
    />
  );
}
