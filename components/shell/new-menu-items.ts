"use client";

/**
 * components/shell/new-menu-items.ts
 * The four create actions, in pipeline order: lead → quote → job → invoice.
 *
 * Shared by BOTH create surfaces — the sidebar menu on desktop and the topbar
 * menu on mobile — so the two cannot drift. The sidebar is `display:none` below
 * 760px, which is why a second surface exists at all.
 */

import { useRouter } from "next/navigation";
import { useOpenModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

export interface NewMenuItem {
  readonly label: string;
  readonly action: () => void;
}

/** @param close run after any action, to collapse the surface that opened it. */
export function useNewMenuItems(close: () => void): readonly NewMenuItem[] {
  const router = useRouter();
  const openModal = useOpenModal();
  const addInvoice = useAppStore((s) => s.addInvoice);

  return [
    {
      label: "New customer",
      action: () => {
        openModal(MODAL.NEW_CUSTOMER);
        close();
      },
    },
    {
      label: "New quote",
      action: () => {
        router.push("/composer");
        close();
      },
    },
    {
      label: "New job",
      action: () => {
        openModal(MODAL.NEW_JOB);
        close();
      },
    },
    {
      label: "New invoice",
      action: () => {
        const inv = addInvoice({
          jobId: null, leadId: "", cust: "", phone: "", title: "New invoice",
          lines: [], total: 0, depPaid: 0, payments: [], status: "draft", age: 0, archived: false,
        });
        openModal(MODAL.INVOICE, { invoiceId: inv.id });
        close();
      },
    },
  ];
}
