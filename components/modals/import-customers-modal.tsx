"use client";

/**
 * Import customers from a CSV exported by ANY system (QuickBooks, Google Contacts, Jobber, a
 * spreadsheet). All parsing, mapping and validation happen in the browser; only clean rows are
 * sent, in chunks, to v1.customers.importCustomers. Dedupe by phone is handled server-side.
 * No file touches the server.
 *
 * The flow itself lives in ImportModal — this file supplies the descriptor, the wording, and how
 * to send a chunk.
 */

import { api } from "@/lib/trpc/client";
import { CUSTOMER_IMPORT } from "@/lib/import/engine/descriptors";
import type { BuiltRow } from "@/lib/import/engine/descriptor";
import { ImportModal, type ImportModalCopy } from "./import-modal";

/** The row shape v1.customers.importCustomers accepts, mirrored from its Zod input. */
interface CustomerImportRow {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  notes: string | null;
}

const COPY: ImportModalCopy = {
  title: "Import customers",
  uploadHint:
    "Bring in your customers from QuickBooks, Google Contacts, Jobber, or a spreadsheet — export a CSV from that tool and drop it here.",
  skipReason: "no name",
  importLabel: (n) => `Import ${n} customer${n === 1 ? "" : "s"}`,
  doneHeadline: (created) => `${created} customer${created === 1 ? "" : "s"} added`,
  dedupedLabel: (n) => `${n} already on file`,
};

export function ImportCustomersModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.customers.importCustomers.useMutation();

  return (
    <ImportModal
      descriptor={CUSTOMER_IMPORT}
      copy={COPY}
      isPending={importMut.isPending}
      sendChunk={(rows: BuiltRow[]) =>
        importMut.mutateAsync({ rows: rows as unknown as CustomerImportRow[] })
      }
      onChunkDone={() => utils.v1.customers.invalidate()}
    />
  );
}
