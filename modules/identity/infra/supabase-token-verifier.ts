import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TokenVerifier } from "../domain/auth-provider";

// Verifies a Supabase access token by asking Supabase Auth who it belongs to. getUser validates
// signature + expiry server-side and reflects revocation, which local JWT checks cannot.
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async verify(accessToken: string): Promise<{ authUserId: string } | null> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { authUserId: data.user.id };
  }
}

export const createSupabaseTokenVerifier = (url: string, anonKey: string): SupabaseTokenVerifier =>
  new SupabaseTokenVerifier(
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
