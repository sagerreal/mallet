"use client";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export const signIn = async (email: string, password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signInWithPassword({ email, password });
  return error ? "Email or password is incorrect." : null;
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  await createSupabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
};

export const updatePassword = async (password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.updateUser({ password });
  return error ? error.message : null;
};

// Invite-accept: an invited member sets their password AND their display name in one step.
// The name goes onto the auth user's user_metadata; refreshSession() then re-mints the access
// token so the fresh JWT carries user_metadata.name into provisioning at /welcome (the token
// established at /auth/callback predates this update). Provisioning writes it to users.name.
export const completeInvite = async (password: string, name: string): Promise<string | null> => {
  const supabase = createSupabaseBrowser();
  const trimmedName = name.trim();
  const { error } = await supabase.auth.updateUser({
    password,
    ...(trimmedName ? { data: { name: trimmedName } } : {}),
  });
  if (error) return error.message;
  await supabase.auth.refreshSession();
  return null;
};

export const signOut = async (): Promise<void> => {
  await createSupabaseBrowser().auth.signOut();
};
