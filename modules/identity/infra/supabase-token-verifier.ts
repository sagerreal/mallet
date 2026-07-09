import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TokenVerifier, VerifiedToken } from "../domain/auth-provider";

// Verifies a Supabase access token by asking Supabase Auth who it belongs to. getUser validates
// signature + expiry server-side and reflects revocation, which local JWT checks cannot.
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async verify(accessToken: string): Promise<VerifiedToken | null> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata ?? {};
    const name =
      typeof meta.full_name === "string" && meta.full_name.trim()
        ? meta.full_name.trim()
        : typeof meta.name === "string" && meta.name.trim()
          ? meta.name.trim()
          : null;
    return {
      authUserId: data.user.id,
      email: data.user.email ?? "",
      orgNameHint: typeof meta.org_name === "string" ? meta.org_name : null,
      name,
    };
  }
}

export const createSupabaseTokenVerifier = (url: string, anonKey: string): SupabaseTokenVerifier =>
  new SupabaseTokenVerifier(
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
