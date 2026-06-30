import type { Context } from "./init";
import type { AppDeps } from "./deps";

// Build the per-request context. Pulls a Bearer token, authenticates it to a Principal (or
// leaves it null for anonymous callers — protected procedures then reject). No tenant tx yet;
// that opens in the org-tx middleware once a procedure requires it.
export const createContext = async (opts: {
  req: Request;
  deps: AppDeps;
}): Promise<Context> => {
  const header = opts.req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  let principal: Context["principal"] = null;
  if (token) {
    const result = await opts.deps.authProvider.authenticate(token);
    if (result.ok) principal = result.value;
  }

  return { principal, tx: null, deps: opts.deps };
};
