/**
 * lib/store/write-error.ts
 * The single reporting seam for failed optimistic writes.
 *
 * Every store action writes optimistically, calls tRPC, and rolls back on
 * failure. Before this existed, the rollback was silent: the user watched their
 * change revert with no explanation, and roughly two thirds of the app's write
 * paths logged nothing outside dev. That violated the house rule "no silent
 * failures" ~67 times.
 *
 * Deliberately a tiny emitter rather than store state: slices call it from inside
 * `.catch()` without needing `set`, and the shell subscribes once to announce the
 * failure. Keeping it out of the store also keeps it out of every selector.
 */

export interface WriteError {
  /** The store action that failed, e.g. "archiveLead". */
  action: string;
  /** User-facing sentence: what failed and what to do. */
  message: string;
  /** Monotonic id so repeat failures re-announce. */
  seq: number;
}

type Listener = (e: WriteError) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** Turn an action name into a plain-language sentence. "archiveLead" → "archive lead". */
function humanize(action: string): string {
  return action
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
}

/**
 * Report a rolled-back write. Call from the `.catch()` that restores the
 * snapshot — it replaces the old NODE_ENV-guarded console.error.
 */
export function reportWriteError(action: string, err: unknown): void {
  seq += 1;
  const event: WriteError = {
    action,
    message: `Couldn't ${humanize(action)} — your change was undone. Check your connection and try again.`,
    seq,
  };

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[store] ${action} failed — rolled back`, err);
  }

  for (const listener of listeners) listener(event);
}

/** Subscribe to write failures. Returns an unsubscribe function. */
export function subscribeWriteErrors(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — drops all subscribers. */
export function resetWriteErrorListeners(): void {
  listeners.clear();
}
