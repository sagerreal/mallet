"use client";

/**
 * components/shared/chat-image.tsx
 * A photo inside a chat bubble — the app's FIRST rendered-back stored image.
 *
 * Attachments live in a private bucket, so there is no permanent URL to put in an `src`. This
 * asks the server for a short-lived signed URL (membership checked, prefix re-validated) and
 * renders that. React Query caches it just under its expiry, so scrolling a thread does not
 * re-sign the same photo on every paint.
 *
 * A plain `<img>`, not next/image: the URL is signed, single-use-ish and expiring, which defeats
 * the image optimiser's cache and would have it re-fetch a dead link. Same call the QR component
 * makes for the same reason.
 */

import { api } from "@/lib/trpc/client";

/** Just under the gateway's 300s TTL, so a cached URL is never handed out already expired. */
const VIEW_URL_STALE_MS = 240_000;

interface ChatImageProps {
  readonly threadId: string;
  readonly path: string;
  /** The caption, or a stated fallback — never empty: an image with no alt fails the a11y gate. */
  readonly alt: string;
}

export function ChatImage({ threadId, path, alt }: ChatImageProps) {
  const { data, isLoading, isError } = api.v1.teamChat.attachmentViewUrl.useQuery(
    { threadId, path },
    { staleTime: VIEW_URL_STALE_MS, refetchOnWindowFocus: false, retry: 1 },
  );

  // A fixed-height placeholder for both the loading and failed states: the bubble must not resize
  // under the reader's thumb when the photo lands, and a broken photo has to say so rather than
  // leaving a silent gap where a picture should be.
  if (isLoading) {
    return <div className="chat-photo chat-photo-ph sk" aria-hidden="true" />;
  }
  if (isError || !data) {
    return (
      <div className="chat-photo chat-photo-ph" role="status">
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          Photo didn&rsquo;t load
        </span>
      </div>
    );
  }

  return (
    <img src={data.url} alt={alt} className="chat-photo" loading="lazy" />
  );
}
