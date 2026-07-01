import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";

// Extract the Bearer token and resolve it to a Principal via the per-tenant API-key authenticator.
// Returns null on any failure (no token / wrong prefix / unknown or revoked key) — the route 401s.
// orgId/role come only from the resolved key row, so a caller can never assert a different tenant.
export const authenticateMcpRequest = async (request: Request, deps: AppDeps): Promise<Principal | null> => {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  return deps.apiKeyAuthenticator.authenticate(token);
};
