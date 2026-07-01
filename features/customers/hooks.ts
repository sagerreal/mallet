"use client";
import { api } from "@/lib/trpc/client";

export const useCustomers = (stage?: "new" | "contacted" | "quote_sent" | "won" | "lost") =>
  api.v1.customers.list.useQuery({ limit: 50, stage });

export const useCustomer = (leadId: string) => api.v1.customers.get.useQuery({ leadId });

export const useCreateCustomer = () => {
  const utils = api.useUtils();
  return api.v1.customers.create.useMutation({ onSuccess: () => utils.v1.customers.list.invalidate() });
};
