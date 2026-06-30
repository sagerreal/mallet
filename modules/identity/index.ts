// Public surface for the identity module — the only sanctioned import seam (architecture rule).
import type { Database } from "@mallet/shared/db/client";
import { SupabaseAuthProvider } from "./infra/supabase-auth-provider";
import { createSupabaseTokenVerifier } from "./infra/supabase-token-verifier";
import { DbPrincipalResolver } from "./infra/db-principal-resolver";

export type { Principal, Role } from "./domain/principal";
export { isRole, ROLES } from "./domain/principal";
export type { AuthProvider, TokenVerifier, PrincipalResolver } from "./domain/auth-provider";

export interface AuthProviderDeps {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly db: Database;
}

// Wire the production AuthProvider: Supabase token verification + DB-backed principal lookup.
export const createAuthProvider = (deps: AuthProviderDeps): SupabaseAuthProvider =>
  new SupabaseAuthProvider(
    createSupabaseTokenVerifier(deps.supabaseUrl, deps.supabaseAnonKey),
    new DbPrincipalResolver(deps.db),
  );
