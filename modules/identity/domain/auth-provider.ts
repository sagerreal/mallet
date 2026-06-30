import type { Result, AppError } from "@mallet/shared/types";
import type { Principal } from "./principal";

// Turns an inbound access token into a Principal. The adapter (Supabase today, swappable later)
// lives behind this port so the request pipeline never depends on a specific auth vendor.
export interface AuthProvider {
  authenticate(accessToken: string): Promise<Result<Principal, AppError>>;
}

// Two collaborators the provider composes — each independently testable.

// Verifies a token's signature/expiry and extracts the auth identity (the Supabase user id).
export interface TokenVerifier {
  verify(accessToken: string): Promise<{ authUserId: string } | null>;
}

// Maps a verified auth identity to its provisioned org membership. Returns null if the auth
// user has no Mallet account yet.
export interface PrincipalResolver {
  resolve(authUserId: string): Promise<Principal | null>;
}
