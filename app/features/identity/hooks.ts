"use client";
import { api, type RouterOutputs } from "@/lib/trpc/client";

// `initial` is the server-resolved me DTO (from the office/field layout). When
// present it seeds the query so the shell paints the correct role + identity on
// first render — no cold-load flash — while React Query still revalidates.
export const useMe = (initial?: RouterOutputs["v1"]["identity"]["me"]) =>
  api.v1.identity.me.useQuery(undefined, { staleTime: 5 * 60_000, retry: false, initialData: initial });
export const useMembers = () => api.v1.identity.members.useQuery();
// Idempotent org provisioning — called once after login by the welcome screen.
export const useEnsureProvisioned = () => api.v1.identity.signup.useMutation();
