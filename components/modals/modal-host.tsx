/**
 * components/modals/modal-host.tsx
 * Reads activeModal from the store and renders the matching modal content.
 * Mounted once in (office)/layout.tsx — works app-wide.
 *
 * All modal content components are loaded via next/dynamic (ssr:false) so the
 * 261KB modal chunk is deferred from the shared first-load bundle.
 *
 * Every one of them passes a `loading` fallback. Without it dynamic() renders null while the chunk
 * arrives, and the shell — which paints immediately — showed an empty card collapsed to the height
 * of its ✕ before snapping open. "Imperceptible" held on a warm chunk and not on a cold one.
 */

"use client";

import dynamic from "next/dynamic";
import { useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { Modal } from "./modal";
import { ModalLoading } from "./modal-loading";

// ----- dynamic modal content imports (all named exports → { default: X } -----

const LeadModal = dynamic(
  () => import("./lead-modal/lead-modal").then((m) => ({ default: m.LeadModal })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const NewCustomerModal = dynamic(
  () => import("./new-customer-modal").then((m) => ({ default: m.NewCustomerModal })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const SweepModalContent = dynamic(
  () => import("./sweep-modal").then((m) => ({ default: m.SweepModalContent })),

  { ssr: false, loading: () => <ModalLoading size="sm" /> },
);

const QuoteSweepModalContent = dynamic(
  () => import("./quote-sweep-modal").then((m) => ({ default: m.QuoteSweepModalContent })),

  { ssr: false, loading: () => <ModalLoading size="sm" /> },
);

const ThreadModalContent = dynamic(
  () => import("./thread-modal").then((m) => ({ default: m.ThreadModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const CallModalContent = dynamic(
  () => import("./call-modal").then((m) => ({ default: m.CallModalContent })),

  { ssr: false, loading: () => <ModalLoading size="sm" /> },
);

const EstimateModalContent = dynamic(
  () => import("./estimate-modal").then((m) => ({ default: m.EstimateModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const JobModalContent = dynamic(
  () => import("./job-modal").then((m) => ({ default: m.JobModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const NewJobModalContent = dynamic(
  () => import("./new-job-modal").then((m) => ({ default: m.NewJobModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const EvisitModalContent = dynamic(
  () => import("./evisit-modal").then((m) => ({ default: m.EvisitModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const PriceBuilderModalContent = dynamic(
  () => import("./price-builder-modal").then((m) => ({ default: m.PriceBuilderModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const TechQuoteModalContent = dynamic(
  () => import("./tech-quote-modal").then((m) => ({ default: m.TechQuoteModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const InvoiceModalContent = dynamic(
  () => import("./invoice-modal").then((m) => ({ default: m.InvoiceModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const TechJobModalContent = dynamic(
  () => import("./tech-job-modal/tech-job-modal").then((m) => ({ default: m.TechJobModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const CustQuoteModalContent = dynamic(
  () => import("./cust-quote-modal").then((m) => ({ default: m.CustQuoteModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const CustInvoiceModalContent = dynamic(
  () => import("./cust-invoice-modal").then((m) => ({ default: m.CustInvoiceModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const CloseOutModalContent = dynamic(
  () => import("./close-out-modal").then((m) => ({ default: m.CloseOutModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const VisitModalContent = dynamic(
  () => import("./visit-modal").then((m) => ({ default: m.VisitModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const CleanUpModalContent = dynamic(
  () => import("./placeholder-modals").then((m) => ({ default: m.CleanUpModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const CompanyViewModalContent = dynamic(
  () => import("./company-view-modal").then((m) => ({ default: m.CompanyViewModalContent })),

  { ssr: false, loading: () => <ModalLoading size="md" /> },
);

const ImportCustomersModalContent = dynamic(
  () => import("./import-customers-modal").then((m) => ({ default: m.ImportCustomersModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

const ImportServicesModalContent = dynamic(
  () => import("./import-services-modal").then((m) => ({ default: m.ImportServicesModalContent })),

  { ssr: false, loading: () => <ModalLoading size="lg" /> },
);

// ---------------------------------------------------------------------------

export function ModalHost() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const id = activeModal?.id;

  // Every drill-in (Call / Text / Book-a-visit / builders / previews) is PUSHED
  // from its opener, so plain close pops back to it via the ui-slice modal
  // back-stack — never a dead-end blank list, no returnTo/backTo helpers.

  return (
    <>
      <LeadModal open={id === MODAL.LEAD} />
      <NewCustomerModal open={id === MODAL.NEW_CUSTOMER} />

      <Modal open={id === MODAL.CALL} onClose={close}>
        <CallModalContent />
      </Modal>

      <Modal open={id === MODAL.THREAD} onClose={close}>
        <ThreadModalContent />
      </Modal>

      <Modal open={id === MODAL.VISIT} onClose={close}>
        <VisitModalContent />
      </Modal>

      <Modal open={id === MODAL.CLEAN_UP} onClose={close}>
        <CleanUpModalContent />
      </Modal>

      <Modal open={id === MODAL.SWEEP} onClose={close}>
        <SweepModalContent />
      </Modal>

      <Modal open={id === MODAL.IMPORT_CUSTOMERS} onClose={close}>
        <ImportCustomersModalContent />
      </Modal>

      <Modal open={id === MODAL.IMPORT_SERVICES} onClose={close}>
        <ImportServicesModalContent />
      </Modal>

      <Modal open={id === MODAL.QUOTE_SWEEP} onClose={close}>
        <QuoteSweepModalContent />
      </Modal>

      <Modal open={id === MODAL.EST} onClose={close} wide>
        <EstimateModalContent />
      </Modal>

      <Modal open={id === MODAL.JOB} onClose={close} wide>
        <JobModalContent />
      </Modal>

      <Modal open={id === MODAL.NEW_JOB} onClose={close}>
        <NewJobModalContent />
      </Modal>

      <Modal open={id === MODAL.EVISIT} onClose={close}>
        <EvisitModalContent />
      </Modal>

      {/* 560px — the prototype's tq sheet width; keeps the add-a-line tiles a 2×2 grid */}
      <Modal open={id === MODAL.PRICE_BUILDER} onClose={close} maxWidth={560}>
        <PriceBuilderModalContent />
      </Modal>

      <Modal open={id === MODAL.TECH_QUOTE} onClose={close} maxWidth={560}>
        <TechQuoteModalContent />
      </Modal>

      <Modal open={id === MODAL.INVOICE} onClose={close} wide>
        <InvoiceModalContent />
      </Modal>

      <Modal open={id === MODAL.TECH_JOB} onClose={close}>
        <TechJobModalContent />
      </Modal>

      <Modal open={id === MODAL.CUST_QUOTE} onClose={close}>
        <CustQuoteModalContent />
      </Modal>

      <Modal open={id === MODAL.CUST_INVOICE} onClose={close}>
        <CustInvoiceModalContent />
      </Modal>

      <Modal open={id === MODAL.CLOSE_OUT} onClose={close} wide>
        <CloseOutModalContent />
      </Modal>

      <Modal open={id === MODAL.COMPANY} onClose={close} wide>
        <CompanyViewModalContent />
      </Modal>
    </>
  );
}
