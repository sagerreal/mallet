"use client";
import { api } from "@/lib/trpc/client";

type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

const invalidator = () => {
  const utils = api.useUtils();
  return () => Promise.all([utils.v1.quoting.list.invalidate(), utils.v1.quoting.get.invalidate()]);
};

export const useQuotes = (status?: EstimateStatus) => api.v1.quoting.list.useQuery({ limit: 50, status });
export const useQuote = (estimateId: string) => api.v1.quoting.get.useQuery({ estimateId });

export const useDraftQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.draft.useMutation({ onSuccess: invalidate });
};

export const useSendQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.send.useMutation({ onSuccess: invalidate });
};

export const useAcceptQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.accept.useMutation({ onSuccess: invalidate });
};

export const useDeclineQuote = () => {
  const invalidate = invalidator();
  return api.v1.quoting.decline.useMutation({ onSuccess: invalidate });
};
