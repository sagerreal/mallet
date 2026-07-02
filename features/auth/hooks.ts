"use client";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export const signIn = async (email: string, password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signInWithPassword({ email, password });
  return error ? "Email or password is incorrect." : null;
};

// org_name rides in user_metadata so provisioning can read it AFTER email confirmation,
// when the signup form's state is long gone.
export const signUp = async (email: string, password: string, orgName: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.signUp({
    email,
    password,
    options: { data: { org_name: orgName }, emailRedirectTo: `${window.location.origin}/auth/confirm` },
  });
  return error ? error.message : null;
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  await createSupabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
};

export const updatePassword = async (password: string): Promise<string | null> => {
  const { error } = await createSupabaseBrowser().auth.updateUser({ password });
  return error ? error.message : null;
};

export const signOut = async (): Promise<void> => {
  await createSupabaseBrowser().auth.signOut();
};
