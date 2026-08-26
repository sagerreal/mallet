import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMutate = vi.fn();
const uploadToSignedUrl = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { customers: { noteUploadUrl: { mutate: (a: unknown) => uploadMutate(a) } } } },
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: () => ({
    storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) },
  }),
}));

import { uploadLeadNoteFile, NOTE_ATTACH_ACCEPT } from "./upload-lead-note-file";
import { UnsupportedFileError, FileTooLargeError, MAX_FILE_BYTES } from "./upload-job-file";

const file = (name: string, size = 1000): File => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  uploadMutate.mockResolvedValue({ storagePath: "org-1/leads/lead-1/obj.jpg", token: "tok" });
  uploadToSignedUrl.mockResolvedValue({ error: null });
});

describe("NOTE_ATTACH_ACCEPT", () => {
  // The picker must not offer something the server will refuse — a file dialog that shows a
  // .docm and then rejects it is a dead end dressed up as a choice.
  it("lists exactly the extensions the upload accepts", () => {
    expect(NOTE_ATTACH_ACCEPT.split(",").sort()).toEqual(
      [".csv", ".heic", ".jpeg", ".jpg", ".pdf", ".png", ".txt", ".webp"],
    );
  });
});

describe("uploadLeadNoteFile", () => {
  it("returns what the note has to carry — the SERVER's path, the mime, the name", async () => {
    const att = await uploadLeadNoteFile("lead-1", file("panel-label.jpg"));
    expect(att).toEqual({
      path: "org-1/leads/lead-1/obj.jpg",
      type: "image/jpeg",
      name: "panel-label.jpg",
    });
  });

  it("sends the bytes untouched — no canvas re-encode to blur the small print", async () => {
    const f = file("permit-2939-silva.pdf");
    await uploadLeadNoteFile("lead-1", f);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("org-1/leads/lead-1/obj.jpg", "tok", f, {
      contentType: "application/pdf",
    });
  });

  // The extension decides, not file.type: browsers report an empty or wrong type for plenty of
  // files, and the server's own gate is the extension in the storage key.
  it("refuses a type the server would reject, BEFORE any network call", async () => {
    await expect(uploadLeadNoteFile("lead-1", file("macro.docm"))).rejects.toBeInstanceOf(UnsupportedFileError);
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("refuses a file with no extension at all", async () => {
    await expect(uploadLeadNoteFile("lead-1", file("scan"))).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("refuses an oversized file before uploading it", async () => {
    await expect(
      uploadLeadNoteFile("lead-1", file("huge.pdf", MAX_FILE_BYTES + 1)),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  // A note must never point at bytes that were never stored.
  it("throws rather than returning a reference when the PUT fails", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: { message: "network" } });
    await expect(uploadLeadNoteFile("lead-1", file("a.pdf"))).rejects.toThrow(/upload failed/);
  });

  it("truncates an absurd filename rather than failing the upload", async () => {
    const att = await uploadLeadNoteFile("lead-1", file("a".repeat(400) + ".pdf"));
    expect(att.name.length).toBeLessThanOrEqual(255);
  });
});
