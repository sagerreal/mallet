import { describe, it, expect } from "vitest";
import { dtoJobToStoreJob } from "./dto-mapper";

/**
 * PHOTOS AND FILES COME OUT OF ONE TABLE. The server keeps both in job_photos; the client needs
 * them apart, because a thumbnail grid and a named link are different renders.
 */
const base = {
  id: "job-1",
  leadId: "lead-1",
  title: "t",
  status: "scheduled",
  lines: [],
  addons: [],
  visits: [],
  verifyAnswers: [],
} as never;

const map = (photos: unknown[]) => dtoJobToStoreJob({ ...(base as object), photos } as never);

describe("dtoJobToStoreJob — attachments", () => {
  it("routes an image to photos and a PDF to files", () => {
    const j = map([
      { id: "p1", storagePath: "o/j/a.jpg", caption: null, mimeType: "image/jpeg", fileName: null },
      { id: "f1", storagePath: "o/j/b.pdf", caption: "the permit", mimeType: "application/pdf", fileName: "permit.pdf" },
    ]);
    expect(j.photos).toEqual(["o/j/a.jpg"]);
    expect(j.files).toHaveLength(1);
    expect(j.files?.[0]).toEqual({
      id: "f1",
      storagePath: "o/j/b.pdf",
      name: "permit.pdf",
      mimeType: "application/pdf",
      caption: "the permit",
    });
  });

  /**
   * A NULL MIME IS AN IMAGE, not an unknown. Every row written before attachments existed was one
   * — the upload input only ever admitted jpg/jpeg/png/webp — so treating null as a file would
   * move every historical photo out of the grid and into a list of nameless links.
   */
  it("treats a row with no mime as a photo", () => {
    const j = map([{ id: "p1", storagePath: "o/j/old.jpg", caption: null }]);
    expect(j.photos).toEqual(["o/j/old.jpg"]);
    expect(j.files ?? []).toHaveLength(0);
  });

  // A document with no name is unopenable in practice.
  it("falls back to the storage key's tail when no filename was sent", () => {
    const j = map([{ id: "f1", storagePath: "o/j/abc123.pdf", caption: null, mimeType: "application/pdf" }]);
    expect(j.files?.[0]?.name).toBe("abc123.pdf");
  });

  it("handles a job with no attachments at all", () => {
    const j = map([]);
    expect(j.photos).toEqual([]);
    expect(j.files ?? []).toEqual([]);
  });
});
