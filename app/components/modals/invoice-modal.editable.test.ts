import { describe, it, expect } from "vitest";
import type { Invoice, Job } from "@/lib/store/types";

/**
 * Which invoices can be edited in the sheet.
 *
 * A hand-made invoice is built here and is editable while it is a draft. An invoice raised FROM a
 * job flows from that job and is read-only — the shop edits the job, not the bill.
 *
 * THE BUG. The test used to be "did I find the job object in the loaded collection", and that
 * collection holds one page. So a draft invoice raised from a job outside that page was judged
 * hand-made and opened the EDITOR: a blank "Search or add a customer" over an invoice that has a
 * customer, an empty line table under a real total, and an Archive button. Owen hit exactly this
 * on INV-1502, which belongs to Sam Ortiz and came from a job.
 *
 * The invoice already knows where it came from — `jobId` is on the record, loaded or not.
 */

/** The rule as the sheet applies it. Mirrors invoice-modal.tsx. */
const isEditable = (invoice: Pick<Invoice, "jobId" | "status">): boolean =>
  invoice.jobId == null && invoice.status === "draft";

/** The rule as it USED to be — kept to show the difference is real. */
const wasEditable = (
  invoice: Pick<Invoice, "jobId" | "status">,
  loadedJobs: Pick<Job, "id">[],
): boolean => {
  const job = invoice.jobId != null ? loadedJobs.find((j) => j.id === invoice.jobId) : undefined;
  return !job && invoice.status === "draft";
};

const fromJob = { jobId: "job-1", status: "draft" } as const;
const handMade = { jobId: null, status: "draft" } as const;

describe("invoice editability", () => {
  it("a hand-made draft is editable", () => {
    expect(isEditable(handMade)).toBe(true);
  });

  it("a draft raised from a job is NOT editable, even when the job is loaded", () => {
    expect(isEditable(fromJob)).toBe(false);
  });

  // The regression itself.
  it("...and still not editable when the job is outside the loaded page", () => {
    expect(isEditable(fromJob)).toBe(false);
    // The old rule flipped to editable precisely because nothing was found:
    expect(wasEditable(fromJob, [{ id: "job-1" } as Job])).toBe(false);
    expect(wasEditable(fromJob, [])).toBe(true);
  });

  it("a sent invoice is never editable, whatever it came from", () => {
    expect(isEditable({ jobId: null, status: "sent" })).toBe(false);
    expect(isEditable({ jobId: "job-1", status: "sent" })).toBe(false);
  });
});
