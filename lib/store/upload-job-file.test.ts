import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMutate = vi.fn();
const addMutate = vi.fn();
const uploadToSignedUrl = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        photoUploadUrl: { mutate: (a: unknown) => uploadMutate(a) },
        addPhoto: { mutate: (a: unknown) => addMutate(a) },
      },
    },
  },
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: () => ({
    storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) },
  }),
}));

import { uploadJobFile, UnsupportedFileError, FileTooLargeError, MAX_FILE_BYTES } from "./upload-job-file";

const file = (name: string, size = 1000): File => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  uploadMutate.mockResolvedValue({ storagePath: "org/job/abc.pdf", token: "tok" });
  uploadToSignedUrl.mockResolvedValue({ error: null });
  addMutate.mockResolvedValue({});
});

describe("uploadJobFile", () => {
  it("records the mime type and the name a person recognises", async () => {
    await uploadJobFile("job-1", file("permit-2939-silva.pdf"));
    expect(addMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        mimeType: "application/pdf",
        fileName: "permit-2939-silva.pdf",
      }),
    );
  });

  it("sends the bytes untouched — re-encoding a PDF would destroy it", async () => {
    const f = file("spec.pdf");
    await uploadJobFile("job-1", f);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("org/job/abc.pdf", "tok", f, { contentType: "application/pdf" });
  });

  // The extension decides, not file.type: browsers report an empty or wrong type for plenty of
  // files, and the server's own gate is the extension in the storage key.
  it("refuses a type the server would reject, BEFORE any network call", async () => {
    await expect(uploadJobFile("job-1", file("macro.docm"))).rejects.toBeInstanceOf(UnsupportedFileError);
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it("refuses a file with no extension at all", async () => {
    await expect(uploadJobFile("job-1", file("scan"))).rejects.toBeInstanceOf(UnsupportedFileError);
  });

  it("refuses an oversized file before uploading it", async () => {
    await expect(uploadJobFile("job-1", file("huge.pdf", MAX_FILE_BYTES + 1))).rejects.toBeInstanceOf(FileTooLargeError);
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  // A failed PUT must not leave a row pointing at bytes that were never stored.
  it("does not record the attachment when the upload fails", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: { message: "network" } });
    await expect(uploadJobFile("job-1", file("a.pdf"))).rejects.toThrow(/upload failed/);
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("truncates an absurd filename rather than failing the upload", async () => {
    await uploadJobFile("job-1", file("a".repeat(400) + ".pdf"));
    const arg = addMutate.mock.calls[0]![0] as { fileName: string };
    expect(arg.fileName.length).toBeLessThanOrEqual(255);
  });
});
