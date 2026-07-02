"use client";
import { api } from "@/lib/trpc/client";

type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";

const useInvalidateInvoices = () => {
  const utils = api.useUtils();
  return () => Promise.all([utils.v1.invoicing.list.invalidate(), utils.v1.invoicing.get.invalidate()]);
};

export const useInvoices = (status?: InvoiceStatus) => api.v1.invoicing.list.useQuery({ limit: 50, status });
export const useInvoice = (invoiceId: string) => api.v1.invoicing.get.useQuery({ invoiceId });
export const useCreateInvoiceFromJob = () => {
  const i = useInvalidateInvoices();
  return api.v1.invoicing.createFromJob.useMutation({ onSuccess: i });
};
export const useSendInvoice = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.send.useMutation({ onSuccess: i }); };
export const useRecordPayment = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.recordPayment.useMutation({ onSuccess: i }); };
export const useVoidInvoice = () => { const i = useInvalidateInvoices(); return api.v1.invoicing.void.useMutation({ onSuccess: i }); };
export const useCardPaymentLink = () => api.v1.invoicing.createPayment.useMutation();
