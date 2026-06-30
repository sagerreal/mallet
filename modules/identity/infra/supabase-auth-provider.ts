import type { Result, AppError } from "@mallet/shared/types";
import { ok, err, unauthorized } from "@mallet/shared/types";
import type {
  AuthProvider,
  TokenVerifier,
  PrincipalResolver,
} from "../domain/auth-provider";
import type { Principal } from "../domain/principal";

// Composes a token verifier (Supabase) with a principal resolver (DB). Pure orchestration:
// no I/O of its own, so it is unit-tested with fakes. Every failure path is a typed
// UnauthorizedError — the boundary maps it to 401.
export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    private readonly verifier: TokenVerifier,
    private readonly resolver: PrincipalResolver,
  ) {}

  async authenticate(accessToken: string): Promise<Result<Principal, AppError>> {
    if (!accessToken || accessToken.trim().length === 0) {
      return err(unauthorized("missing access token"));
    }
    const verified = await this.verifier.verify(accessToken);
    if (!verified) return err(unauthorized("invalid or expired token"));

    const principal = await this.resolver.resolve(verified.authUserId);
    if (!principal) return err(unauthorized("account is not provisioned in any org"));

    return ok(principal);
  }
}
