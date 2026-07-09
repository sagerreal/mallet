/**
 * components/shell/new-menu.tsx
 * The "+ New" dropdown button (§2.4).
 * Items dispatch openModal() — no magic strings, all MODAL.* constants.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOpenModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface MenuItem {
  label: string;
  action: () => void;
}

export function NewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const openModal = useOpenModal();
  const addInvoice = useAppStore((s) => s.addInvoice);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Pipeline order (matches prototype): lead → quote → job → invoice.
  const items: MenuItem[] = [
    {
      label: "New customer",
      action: () => { openModal(MODAL.NEW_CUSTOMER); setOpen(false); },
    },
    {
      label: "New quote",
      action: () => { router.push("/composer"); setOpen(false); },
    },
    {
      label: "New job",
      action: () => { openModal(MODAL.NEW_JOB); setOpen(false); },
    },
    {
      label: "New invoice",
      action: () => {
        const inv = addInvoice({
          jobId: null, leadId: "", cust: "", phone: "", title: "New invoice",
          lines: [], total: 0, depPaid: 0, payments: [], status: "draft", age: 0, archived: false,
        });
        openModal(MODAL.INVOICE, { invoiceId: inv.id });
        setOpen(false);
      },
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="quickadd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="plus">+</span>
        <span>New</span>
        <span className="nm-caret">▾</span>
      </button>

      {open && (
        <div className="newmenu open">
          {items.map((item) => (
            <button
              key={item.label}
              className="newitem"
              onClick={item.action}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
