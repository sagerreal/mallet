"use client";
import { api } from "@/lib/trpc/client";

// useMyDay lived here and was consumed by nothing — a second, unmemoized subscription to the
// agenda waiting to be picked up. It is deleted rather than ported: the page and the hydrator
// share features/field/my-day-input.ts, and a third caller with its own key is the drift this
// change exists to prevent.
export const useFieldStart = () => {
  const utils = api.useUtils();
  return api.v1.field.start.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
export const useFieldComplete = () => {
  const utils = api.useUtils();
  return api.v1.field.complete.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
