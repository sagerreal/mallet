/**
 * components/modals/modal-host.tsx
 * Reads activeModal from the store and renders the matching modal content.
 * Mounted once in (office)/layout.tsx — works app-wide.
 *
 * All modal content components are loaded via next/dynamic (ssr:false) so the
 * 261KB modal chunk is deferred from the shared first-load bundle. Modals open
 * on user interaction, so the chunk load is imperceptible.
 */

"use client";

import dynamic from "next/dynamic";
import { useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL, type ModalId } from "@/lib/store/modal-ids";
import { Modal } from "./modal";

// ----- dynamic modal content imports (all named exports → { default: X } -----

const LeadModal = dynamic(
  () => import("./lead-modal/lead-modal").then((m) => ({ default: m.LeadModal })),
  { ssr: false },
);

const NewCustomerModal = dynamic(
  () => import("./new-customer-modal").then((m) => ({ default: m.NewCustomerModal })),
  { ssr: false },
);

const SweepModalContent = dynamic(
  () => import("./sweep-modal").then((m) => ({ default: m.SweepModalContent })),
  { ssr: false },
);

const QuoteSweepModalContent = dynamic(
  () => import("./quote-sweep-modal").then((m) => ({ default: m.QuoteSweepModalContent })),
  { ssr: false },
);

const ThreadModalContent = dynamic(
  () => import("./thread-modal").then((m) => ({ default: m.ThreadModalContent })),
  { ssr: false },
);

const CallModalContent = dynamic(
  () => import("./call-modal").then((m) => ({ default: m.CallModalContent })),
  { ssr: false },
);

const EstimateModalContent = dynamic(
  () => import("./estimate-modal").then((m) => ({ default: m.EstimateModalContent })),
  { ssr: false },
);

const JobModalContent = dynamic(
  () => import("./job-modal").then((m) => ({ default: m.JobModalContent })),
  { ssr: false },
);

const NewJobModalContent = dynamic(
  () => import("./new-job-modal").then((m) => ({ default: m.NewJobModalContent })),
  { ssr: false },
);

const EvisitModalContent = dynamic(
  () => import("./evisit-modal").then((m) => ({ default: m.EvisitModalContent })),
  { ssr: false },
);

const PriceBuilderModalContent = dynamic(
  () => import("./price-builder-modal").then((m) => ({ default: m.PriceBuilderModalContent })),
  { ssr: false },
);

const TechQuoteModalContent = dynamic(
  () => import("./tech-quote-modal").then((m) => ({ default: m.TechQuoteModalContent })),
  { ssr: false },
);

const InvoiceModalContent = dynamic(
  () => import("./invoice-modal").then((m) => ({ default: m.InvoiceModalContent })),
  { ssr: false },
);

const TechJobModalContent = dynamic(
  () => import("./tech-job-modal").then((m) => ({ default: m.TechJobModalContent })),
  { ssr: false },
);

const CustQuoteModalContent = dynamic(
  () => import("./cust-quote-modal").then((m) => ({ default: m.CustQuoteModalContent })),
  { ssr: false },
);

const CustInvoiceModalContent = dynamic(
  () => import("./cust-invoice-modal").then((m) => ({ default: m.CustInvoiceModalContent })),
  { ssr: false },
);

const CloseOutModalContent = dynamic(
  () => import("./close-out-modal").then((m) => ({ default: m.CloseOutModalContent })),
  { ssr: false },
);

const VisitModalContent = dynamic(
  () => import("./visit-modal").then((m) => ({ default: m.VisitModalContent })),
  { ssr: false },
);

const CleanUpModalContent = dynamic(
  () => import("./placeholder-modals").then((m) => ({ default: m.CleanUpModalContent })),
  { ssr: false },
);

const CompanyViewModalContent = dynamic(
  () => import("./company-view-modal").then((m) => ({ default: m.CompanyViewModalContent })),
  { ssr: false },
);

const ImportCustomersModalContent = dynamic(
  () => import("./import-customers-modal").then((m) => ({ default: m.ImportCustomersModalContent })),
  { ssr: false },
);

const ImportServicesModalContent = dynamic(
  () => import("./import-services-modal").then((m) => ({ default: m.ImportServicesModalContent })),
  { ssr: false },
);

// ---------------------------------------------------------------------------

export function ModalHost() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const id = activeModal?.id;

  // The price / tech-quote builders return to the job they were opened from on
  // ✕ / backdrop / Escape (prototype tqClose re-opens the job), never a dead end.
  const backToJob = (jobModalId: ModalId) => () => {
    const jobId = activeModal?.params?.jobId;
    if (typeof jobId === "string" && jobId.length > 0) openModal(jobModalId, { jobId });
    else close();
  };

  // Contact/booking sub-modals (Call / Text / Book-a-visit) are PUSHED from their
  // opener, so plain close pops back to it via the ui-slice modal back-stack —
  // never a dead-end blank list, no returnTo params.

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
      <Modal open={id === MODAL.PRICE_BUILDER} onClose={backToJob(MODAL.JOB)} maxWidth={560}>
        <PriceBuilderModalContent />
      </Modal>

      <Modal open={id === MODAL.TECH_QUOTE} onClose={backToJob(MODAL.TECH_JOB)} maxWidth={560}>
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
