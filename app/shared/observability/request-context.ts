import { AsyncLocalStorage } from "node:async_hooks";

// Per-request ambient context, propagated across awaits via AsyncLocalStorage so the logger can
// stamp every line with request_id/org_id without threading them through every call.
export interface RequestContext {
  requestId: string;
  orgId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

// The store object is owned by the current request scope; enriching it in place (once the
// principal is known) is the standard ALS pattern and does not leak across requests.
export const enrichRequestContext = (patch: Partial<Omit<RequestContext, "requestId">>): void => {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
};
