"use client";
import { api } from "@/lib/trpc/client";

export const useMyDay = () => api.v1.field.myDay.useQuery(undefined, { refetchInterval: 60_000 });
export const useFieldStart = () => {
  const utils = api.useUtils();
  return api.v1.field.start.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
export const useFieldComplete = () => {
  const utils = api.useUtils();
  return api.v1.field.complete.useMutation({ onSuccess: () => utils.v1.field.myDay.invalidate() });
};
