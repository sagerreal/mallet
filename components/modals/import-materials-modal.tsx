"use client";

/**
 * Import price book materials — the sellable parts a shop stocks — from a CSV exported by any
 * system, or straight from a supplier's price sheet. All parsing and validation happen in the
 * browser; no file touches the server.
 *
 * Re-importing UPDATES rather than duplicating, so a supplier's quarterly cost sheet can be
 * dropped in as-is. Only the columns in the file change.
 *
 * The flow itself lives in ImportModal — this file supplies the descriptor, the wording, and how
 * to send a chunk.
 */

import { api } from "@/lib/trpc/client";
import { MATERIAL_IMPORT } from "@/lib/import/engine/descriptors";
import type { BuiltRow } from "@/lib/import/engine/descriptor";
import { ImportModal, type ImportModalCopy } from "./import-modal";

/** The row shape v1.pricebook.importMaterials accepts, mirrored from its Zod input. */
interface MaterialImportRow {
  name: string;
  category: string | null;
  description: string | null;
  code: string | null;
  unitCostCents: number;
  unitPriceCents?: number;
  unitOfMeasure?: string;
  vendor: string | null;
  taxable: boolean;
}

const COPY: ImportModalCopy = {
  title: "Import materials",
  uploadHint:
    "Bring in the parts you stock — from your old system, or straight from a supplier's price sheet. Re-import later to update costs.",
  skipReason: "no name",
  importLabel: (n) => `Import ${n} material${n === 1 ? "" : "s"}`,
  doneHeadline: (created) => `${created} material${created === 1 ? "" : "s"} added`,
  // A material that already exists is PATCHED, never skipped, so this never fires — the done card
  // reports "N updated" instead. Kept for the shared contract.
  dedupedLabel: (n) => `${n} already in your book`,
};

export function ImportMaterialsModalContent() {
  const utils = api.useUtils();
  const importMut = api.v1.pricebook.importMaterials.useMutation();
  const existing = api.v1.pricebook.material.importNames.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const existingNames = new Set(existing.data?.names ?? []);

  return (
    <ImportModal
      descriptor={MATERIAL_IMPORT}
      copy={COPY}
      isPending={importMut.isPending}
      sendChunk={(rows: BuiltRow[]) =>
        importMut.mutateAsync({ rows: rows as unknown as MaterialImportRow[] })
      }
      onChunkDone={async () => {
        await utils.v1.pricebook.material.list.invalidate();
        // Stale after a chunk — a second import in one session must count against what exists NOW.
        await utils.v1.pricebook.material.importNames.invalidate();
      }}
      // Same rule the server applies: exact name, case-insensitive.
      countUpdates={(rows) =>
        rows.filter((r) => existingNames.has(String(r.name ?? "").trim().toLowerCase())).length
      }
    />
  );
}
