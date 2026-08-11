/**
 * components/modals/modal-host.tsx
 * Reads activeModal from the store and renders the matching modal content.
 * Mounted once in (office)/layout.tsx — works app-wide.
 *
 * All modal content components are code-split behind dynamicModal (below) so the ~261KB of
 * modal bodies stays out of the shared first-load bundle — then warmed on IDLE so no open or
 * modal→modal switch ever waits on a chunk. Each body still has a ModalLoading fallback for
 * the genuinely-cold path; without one the shell — which paints immediately — showed an empty
 * card collapsed to the height of its ✕ before snapping open.
 */

"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { Modal } from "./modal";
import { ModalLoading, type ModalBodySize } from "./modal-loading";

/**
 * Hand-rolled next/dynamic. Not for fun: next/dynamic suspends through React.lazy, and once a
 * Suspense FALLBACK has committed React throttles its replacement (~300ms floor, the anti-thrash
 * constant) — so even with the chunk warm in the module cache, every first mount of a modal body
 * painted the skeleton for a third of a second. Measured on the production build: chunk fetches
 * all at idle, ZERO network at the switch, and still 320ms of bars.
 *
 * This loader keeps the module in a plain closure instead. Warmed (the idle effect below), the
 * REAL component renders on the very first commit — no Suspense, no fallback, no throttle. Cold,
 * it renders the same ModalLoading and swaps the moment the import resolves, again unthrottled.
 *
 * SSR: this file is client-only, but Next still server-renders client components. The <Modal>
 * shell returns null when closed, so 21 of these never render server-side; the two own-shell
 * modals (Lead / NewCustomer) render with `open: false`, and the fallback gates on that prop so
 * a closed modal can never paint stray skeleton rows into the page.
 */
function dynamicModal<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  size: ModalBodySize,
): ComponentType<P> & { preload: () => Promise<void> } {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = () => {
    pending ??= load().then((m) => {
      Loaded = m.default;
    });
    return pending;
  };
  function DynamicModalBody(props: P) {
    const [, setReady] = useState(Loaded != null);
    useEffect(() => {
      if (Loaded) return;
      let alive = true;
      void preload().then(() => {
        if (alive) setReady(true);
      });
      return () => {
        alive = false;
      };
    }, []);
    if (Loaded) {
      const C = Loaded;
      return <C {...props} />;
    }
    // Closed own-shell modals ("open" in props) must render nothing, not loose bars.
    if ("open" in props && (props as { open?: boolean }).open === false) return null;
    return <ModalLoading size={size} />;
  }
  DynamicModalBody.preload = preload;
  return DynamicModalBody;
}

// ----- dynamic modal content imports (all named exports → { default: X } -----

const loadLeadModal = () => import("./lead-modal/lead-modal").then((m) => ({ default: m.LeadModal }));
const LeadModal = dynamicModal(loadLeadModal, "lg");

const loadNewCustomerModal = () => import("./new-customer-modal").then((m) => ({ default: m.NewCustomerModal }));
const NewCustomerModal = dynamicModal(loadNewCustomerModal, "md");

const loadSweepModalContent = () => import("./sweep-modal").then((m) => ({ default: m.SweepModalContent }));
const SweepModalContent = dynamicModal(loadSweepModalContent, "sm");

const loadQuoteSweepModalContent = () => import("./quote-sweep-modal").then((m) => ({ default: m.QuoteSweepModalContent }));
const QuoteSweepModalContent = dynamicModal(loadQuoteSweepModalContent, "sm");

const loadThreadModalContent = () => import("./thread-modal").then((m) => ({ default: m.ThreadModalContent }));
const ThreadModalContent = dynamicModal(loadThreadModalContent, "md");

const loadCallModalContent = () => import("./call-modal").then((m) => ({ default: m.CallModalContent }));
const CallModalContent = dynamicModal(loadCallModalContent, "sm");

const loadEstimateModalContent = () => import("./estimate-modal").then((m) => ({ default: m.EstimateModalContent }));
const EstimateModalContent = dynamicModal(loadEstimateModalContent, "lg");

const loadJobModalContent = () => import("./job-modal").then((m) => ({ default: m.JobModalContent }));
const JobModalContent = dynamicModal(loadJobModalContent, "lg");

const loadNewJobModalContent = () => import("./new-job-modal").then((m) => ({ default: m.NewJobModalContent }));
const NewJobModalContent = dynamicModal(loadNewJobModalContent, "md");


const loadPriceBuilderModalContent = () => import("./price-builder-modal").then((m) => ({ default: m.PriceBuilderModalContent }));
const PriceBuilderModalContent = dynamicModal(loadPriceBuilderModalContent, "lg");

const loadTechQuoteModalContent = () => import("./tech-quote-modal").then((m) => ({ default: m.TechQuoteModalContent }));
const TechQuoteModalContent = dynamicModal(loadTechQuoteModalContent, "md");

const loadInvoiceModalContent = () => import("./invoice-modal").then((m) => ({ default: m.InvoiceModalContent }));
const InvoiceModalContent = dynamicModal(loadInvoiceModalContent, "lg");

const loadTechJobModalContent = () => import("./tech-job-modal/tech-job-modal").then((m) => ({ default: m.TechJobModalContent }));
const TechJobModalContent = dynamicModal(loadTechJobModalContent, "lg");

const loadCustQuoteModalContent = () => import("./cust-quote-modal").then((m) => ({ default: m.CustQuoteModalContent }));
const CustQuoteModalContent = dynamicModal(loadCustQuoteModalContent, "lg");

const loadCustInvoiceModalContent = () => import("./cust-invoice-modal").then((m) => ({ default: m.CustInvoiceModalContent }));
const CustInvoiceModalContent = dynamicModal(loadCustInvoiceModalContent, "lg");

const loadCloseOutModalContent = () => import("./close-out-modal").then((m) => ({ default: m.CloseOutModalContent }));
const CloseOutModalContent = dynamicModal(loadCloseOutModalContent, "lg");

const loadVisitModalContent = () => import("./visit-modal").then((m) => ({ default: m.VisitModalContent }));
const VisitModalContent = dynamicModal(loadVisitModalContent, "md");

const loadCleanUpModalContent = () => import("./placeholder-modals").then((m) => ({ default: m.CleanUpModalContent }));
const CleanUpModalContent = dynamicModal(loadCleanUpModalContent, "md");

const loadCompanyViewModalContent = () => import("./company-view-modal").then((m) => ({ default: m.CompanyViewModalContent }));
const CompanyViewModalContent = dynamicModal(loadCompanyViewModalContent, "md");

const loadImportCustomersModalContent = () => import("./import-customers-modal").then((m) => ({ default: m.ImportCustomersModalContent }));
const ImportCustomersModalContent = dynamicModal(loadImportCustomersModalContent, "lg");

const loadImportServicesModalContent = () => import("./import-services-modal").then((m) => ({ default: m.ImportServicesModalContent }));
const ImportServicesModalContent = dynamicModal(loadImportServicesModalContent, "lg");

const loadRoomCardModalContent = () => import("./room-card-modal").then((m) => ({ default: m.RoomCardModalContent }));
const RoomCardModalContent = dynamicModal(loadRoomCardModalContent, "md");

const loadSiteTracerModalContent = () => import("./site-tracer/site-tracer-modal").then((m) => ({ default: m.SiteTracerModalContent }));
const SiteTracerModalContent = dynamicModal(loadSiteTracerModalContent, "lg");

/**
 * Every modal chunk, for the idle warm-up below. Built from the SAME `loadX` consts the
 * dynamic() wrappers use, so a new modal added above is one identifier away from being
 * preloaded — and a missed one degrades to today's skeleton, never to breakage.
 */
const MODAL_LOADERS = [loadLeadModal, loadNewCustomerModal, loadSweepModalContent, loadQuoteSweepModalContent, loadThreadModalContent, loadCallModalContent, loadEstimateModalContent, loadJobModalContent, loadNewJobModalContent, loadPriceBuilderModalContent, loadTechQuoteModalContent, loadInvoiceModalContent, loadTechJobModalContent, loadCustQuoteModalContent, loadCustInvoiceModalContent, loadCloseOutModalContent, loadVisitModalContent, loadCleanUpModalContent, loadCompanyViewModalContent, loadImportCustomersModalContent, loadImportServicesModalContent, loadRoomCardModalContent, loadSiteTracerModalContent];

// ---------------------------------------------------------------------------

export function ModalHost() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const id = activeModal?.id;

  /**
   * WARM EVERY MODAL CHUNK ON IDLE. Each body is next/dynamic, so its first render waits
   * on a network fetch behind the ModalLoading skeleton — on a cold chunk that is ~half a
   * second of wordless bars, and on a modal→modal switch it reads as the sheet "glitching"
   * (Owen, on Wrap up). The shell is long interactive by the time idle fires, so this costs
   * no first-load metric; the browser coalesces the imports into its module cache and every
   * later open — first or switched-to — mounts its real content on frame one.
   */
  useEffect(() => {
    const warm = () => {
      for (const load of MODAL_LOADERS) void load();
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const t = setTimeout(warm, 2500);
    return () => clearTimeout(t);
  }, []);

  /**
   * A modal SWITCH (one open sheet replaced by another in the same commit) skips the
   * entrance animation. Replaying it is what Owen saw as a glitch: the outgoing sheet
   * unmounts instantly while the incoming one starts at opacity 0 — a full frame of bare
   * page, then a translucent fade. The ref still holds the PREVIOUS id during the render
   * where it changes (the effect below runs after commit), which is exactly the moment the
   * incoming Modal mounts and decides its class.
   */
  const prevIdRef = useRef<string | undefined>(undefined);
  const switching = prevIdRef.current != null && id != null && prevIdRef.current !== id;
  useEffect(() => {
    prevIdRef.current = id;
  }, [id]);

  // Every drill-in (Call / Text / Book-a-visit / builders / previews) is PUSHED
  // from its opener, so plain close pops back to it via the ui-slice modal
  // back-stack — never a dead-end blank list, no returnTo/backTo helpers.

  return (
    <>
      <LeadModal instant={switching} open={id === MODAL.LEAD} />
      <NewCustomerModal instant={switching} open={id === MODAL.NEW_CUSTOMER} />

      <Modal instant={switching} open={id === MODAL.CALL} onClose={close}>
        <CallModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.THREAD} onClose={close}>
        <ThreadModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.VISIT} onClose={close}>
        <VisitModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.CLEAN_UP} onClose={close}>
        <CleanUpModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.SWEEP} onClose={close}>
        <SweepModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.IMPORT_CUSTOMERS} onClose={close}>
        <ImportCustomersModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.IMPORT_SERVICES} onClose={close}>
        <ImportServicesModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.QUOTE_SWEEP} onClose={close}>
        <QuoteSweepModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.EST} onClose={close} wide>
        <EstimateModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.JOB} onClose={close} wide>
        <JobModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.NEW_JOB} onClose={close}>
        <NewJobModalContent />
      </Modal>


      {/* 560px — the prototype's tq sheet width; keeps the add-a-line tiles a 2×2 grid */}
      <Modal instant={switching} open={id === MODAL.PRICE_BUILDER} onClose={close} maxWidth={560}>
        <PriceBuilderModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.TECH_QUOTE} onClose={close} maxWidth={560}>
        <TechQuoteModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.INVOICE} onClose={close} wide>
        <InvoiceModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.TECH_JOB} onClose={close}>
        <TechJobModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.CUST_QUOTE} onClose={close}>
        <CustQuoteModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.CUST_INVOICE} onClose={close}>
        <CustInvoiceModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.CLOSE_OUT} onClose={close} wide>
        <CloseOutModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.COMPANY} onClose={close} wide>
        <CompanyViewModalContent />
      </Modal>

      <Modal instant={switching} open={id === MODAL.ROOM_CARD} onClose={close}>
        <RoomCardModalContent />
      </Modal>

      {/* wide — the satellite tracer needs the room for imagery. */}
      <Modal instant={switching} open={id === MODAL.SITE_TRACER} onClose={close} wide>
        <SiteTracerModalContent />
      </Modal>
    </>
  );
}
