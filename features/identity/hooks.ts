"use client";
import { api } from "@/lib/trpc/client";

export const useMe = () => api.v1.identity.me.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
export const useMembers = () => api.v1.identity.members.useQuery();
// Idempotent org provisioning — called once after login by the welcome screen.
export const useEnsureProvisioned = () => api.v1.identity.signup.useMutation();
