import type { Result, AppError } from "@mallet/shared/types";
import type { Principal } from "./principal";

// Turns an inbound access token into a Principal. The adapter (Supabase today, swappable later)
// lives behind this port so the request pipeline never depends on a specific auth vendor.
export interface AuthProvider {
  authenticate(accessToken: string): Promise<Result<Principal, AppError>>;
}

// Two collaborators the provider composes — each independently testable.

// Verifies a token's signature/expiry and extracts the auth identity plus signup hints.
export interface VerifiedToken {
  readonly authUserId: string;
  readonly email: string;
  readonly orgNameHint: string | null; // user_metadata.org_name captured at auth signUp
}

export interface TokenVerifier {
  verify(accessToken: string): Promise<VerifiedToken | null>;
}

// Maps a verified auth identity to its provisioned org membership. Returns null if the auth
// user has no Mallet account yet.
export interface PrincipalResolver {
  resolve(authUserId: string): Promise<Principal | null>;
}

// Resolves a static per-tenant API key (Bearer) directly to a Principal — the auth path for the
// remote MCP server (external hosts can't mint Supabase JWTs). Returns null on any failure.
export interface ApiKeyVerifier {
  authenticate(bearerToken: string): Promise<Principal | null>;
}
