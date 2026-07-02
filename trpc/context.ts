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
  let unmapped: Context["unmapped"] = null;
  if (token) {
    const result = await opts.deps.authProvider.authenticate(token);
    if (result.ok) {
      principal = result.value;
    } else {
      // Not provisioned yet (or invalid). A VALID token still identifies the auth user for signup.
      unmapped = await opts.deps.tokenVerifier.verify(token);
    }
  }

  return { principal, unmapped, tx: null, deps: opts.deps };
};
