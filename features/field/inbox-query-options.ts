/**
 * Query options for the Customer Inbox list (v1.messaging.listConversations).
 *
 * A seam, so the invariant is testable: the inbox POLLS, and staleTime matches the poll interval.
 * It used to be staleTime 5s + interval 15s, which guaranteed a fetch (and a list re-render) on
 * nearly every tab click — the data was almost always "stale" by the time you tapped Messages,
 * yet the interval was about to refresh it anyway. With staleTime = the interval, a tab click
 * inside the poll window renders straight from cache and the poll stays the single refresher.
 *
 * Focus refetch stays on: coming back to the app is exactly when a new customer text is most
 * likely to be waiting, and there is no realtime channel for messages.
 */
export const INBOX_POLL_MS = 15_000;

export const inboxQueryOptions = {
  staleTime: INBOX_POLL_MS,
  refetchOnWindowFocus: true,
  refetchInterval: INBOX_POLL_MS,
} as const;
