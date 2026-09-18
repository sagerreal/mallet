import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk, isErr } from "@mallet/shared/types";
import { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET, VIEW_URL_TTL_SECONDS } from "./supabase-photo-storage-gateway";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB = asJobId("11111111-1111-1111-1111-111111111111");

// A minimal fake of the Supabase storage surface the adapter uses.
function fakeStorage(result: {
  data: { signedUrl: string; token: string; path: string } | null;
  error: { message: string } | null;
}) {
  const calls: { bucket: string; path: string }[] = [];
  return {
    calls,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async createSignedUploadUrl(path: string) {
              calls.push({ bucket, path });
              return result;
            },
          };
        },
      },
    },
  };
}

describe("SupabasePhotoStorageGateway", () => {
  it("builds an org/job-prefixed path and returns the signed url + token + path", async () => {
    const fake = fakeStorage({
      data: { signedUrl: "https://x/upload", token: "tok", path: "p" },
      error: null,
    });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "jpg", objectId: "abc" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.signedUrl).toBe("https://x/upload");
      expect(r.value.token).toBe("tok");
      expect(r.value.storagePath).toBe(`${ORG}/${JOB}/abc.jpg`);
    }
    expect(fake.calls[0]?.bucket).toBe(JOB_PHOTOS_BUCKET);
    expect(fake.calls[0]?.path).toBe(`${ORG}/${JOB}/abc.jpg`);
  });

  it("rejects an ext with a path separator (path traversal guard)", async () => {
    const fake = fakeStorage({ data: { signedUrl: "u", token: "t", path: "p" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "../secret", objectId: "abc" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("external_service");
  });

  it("maps a storage error to an external_service Result", async () => {
    const fake = fakeStorage({ data: null, error: { message: "bucket missing" } });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "png", objectId: "abc" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.service).toBe("supabase-storage");
    }
  });

  it("maps a slow storage call to a retryable external_service error (timeout)", async () => {
    const hangingClient = {
      storage: {
        from() {
          return { createSignedUploadUrl: () => new Promise<never>(() => {}) }; // never resolves
        },
      },
    };
    const gw = new SupabasePhotoStorageGateway(() => hangingClient as never, 10); // 10ms timeout
    const r = await gw.createUploadUrl({ orgId: ORG, jobId: JOB, ext: "jpg", objectId: "abc" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.retryable).toBe(true);
    }
  });
});

// ─── download() — the repo's first storage READ ────────────────────────────────
// A Blob-like fake: size + arrayBuffer are all the adapter touches.
function fakeBlob(bytes: number): { size: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return {
    size: bytes,
    async arrayBuffer() {
      return new Uint8Array(Array.from({ length: bytes }, (_, i) => i % 251)).buffer;
    },
  };
}

function fakeDownloadStorage(result: {
  data: { size: number; arrayBuffer(): Promise<ArrayBuffer> } | null;
  error: { message: string } | null;
}) {
  const calls: { bucket: string; path: string }[] = [];
  return {
    calls,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async download(path: string) {
              calls.push({ bucket, path });
              return result;
            },
          };
        },
      },
    },
  };
}

describe("SupabasePhotoStorageGateway.download", () => {
  const CTX = { orgId: ORG, jobId: JOB };
  const GOOD_PATH = `${ORG}/${JOB}/photo1.jpg`;

  it("downloads, base64-encodes, and infers mediaType from the extension", async () => {
    const fake = fakeDownloadStorage({ data: fakeBlob(16), error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.download(GOOD_PATH, CTX);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.mediaType).toBe("image/jpeg");
      expect(r.value.bytes).toBe(16);
      // The base64 round-trips to the fake's deterministic bytes.
      expect(Buffer.from(r.value.dataBase64, "base64")).toHaveLength(16);
    }
    expect(fake.calls[0]?.bucket).toBe(JOB_PHOTOS_BUCKET);
    expect(fake.calls[0]?.path).toBe(GOOD_PATH);
  });

  it("rejects a path outside the verified org/job prefix WITHOUT touching storage", async () => {
    const fake = fakeDownloadStorage({ data: fakeBlob(4), error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.download(`${ORG}/99999999-9999-9999-9999-999999999999/x.jpg`, CTX);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.retryable).toBe(false);
    expect(fake.calls).toHaveLength(0); // never fetched
  });

  it("rejects an unsupported extension (no media type)", async () => {
    const fake = fakeDownloadStorage({ data: fakeBlob(4), error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.download(`${ORG}/${JOB}/malware.svg`, CTX);
    expect(isErr(r)).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a photo over MAX_PHOTO_BYTES", async () => {
    const fake = fakeDownloadStorage({ data: fakeBlob(5 * 1024 * 1024 + 1), error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.download(GOOD_PATH, CTX);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.retryable).toBe(false);
  });

  it("maps a storage error to a retryable external_service Result", async () => {
    const fake = fakeDownloadStorage({ data: null, error: { message: "object not found" } });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.download(GOOD_PATH, CTX);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.retryable).toBe(true);
  });

  it("times out a hung download and maps it to a retryable error", async () => {
    const hung = {
      storage: {
        from() {
          return { download: () => new Promise(() => undefined) };
        },
      },
    };
    const gw = new SupabasePhotoStorageGateway(() => hung as never, 20);
    const r = await gw.download(GOOD_PATH, CTX);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.retryable).toBe(true);
  });
});

// A fake of just the signed-VIEW surface. `expiresIn` is captured so the TTL is asserted rather
// than assumed — a link that outlives its row is the failure mode worth locking down.
function fakeViewStorage(
  result: { data: { signedUrl: string } | null; error: { message: string } | null },
  opts: { hang?: boolean } = {},
) {
  const calls: { bucket: string; path: string; expiresIn: number }[] = [];
  return {
    calls,
    client: {
      storage: {
        from(bucket: string) {
          return {
            async createSignedUrl(path: string, expiresIn: number) {
              calls.push({ bucket, path, expiresIn });
              if (opts.hang) return new Promise<never>(() => {});
              return result;
            },
          };
        },
      },
    },
  };
}

describe("SupabasePhotoStorageGateway.createViewUrl", () => {
  const path = `${ORG}/${JOB}/abc.pdf`;

  it("signs the stored path against the job-photos bucket and returns the url + ttl", async () => {
    const fake = fakeViewStorage({ data: { signedUrl: "https://x/view?sig=1" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createViewUrl(path, { orgId: ORG, jobId: JOB });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.url).toBe("https://x/view?sig=1");
      expect(r.value.expiresInSeconds).toBe(VIEW_URL_TTL_SECONDS);
    }
    expect(fake.calls[0]?.bucket).toBe(JOB_PHOTOS_BUCKET);
    expect(fake.calls[0]?.path).toBe(path);
    expect(fake.calls[0]?.expiresIn).toBe(VIEW_URL_TTL_SECONDS);
  });

  it("signs a DOCUMENT — download() is images-only, this path is not", async () => {
    const fake = fakeViewStorage({ data: { signedUrl: "https://x/view" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    for (const ext of ["pdf", "csv", "txt", "heic", "png"]) {
      const r = await gw.createViewUrl(`${ORG}/${JOB}/f.${ext}`, { orgId: ORG, jobId: JOB });
      expect(isOk(r), ext).toBe(true);
    }
  });

  it("refuses a path outside the org/job prefix — no url is minted", async () => {
    const fake = fakeViewStorage({ data: { signedUrl: "https://x/view" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const other = asOrgId("33333333-3333-3333-3333-333333333333");
    const r = await gw.createViewUrl(`${other}/${JOB}/abc.pdf`, { orgId: ORG, jobId: JOB });
    expect(isErr(r)).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a traversal that would otherwise pass the prefix test", async () => {
    const fake = fakeViewStorage({ data: { signedUrl: "https://x/view" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createViewUrl(`${ORG}/${JOB}/../other/secret.pdf`, { orgId: ORG, jobId: JOB });
    expect(isErr(r)).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an extension the upload path would never have accepted", async () => {
    const fake = fakeViewStorage({ data: { signedUrl: "https://x/view" }, error: null });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    for (const bad of ["svg", "html", "exe", ""]) {
      const r = await gw.createViewUrl(`${ORG}/${JOB}/f.${bad}`, { orgId: ORG, jobId: JOB });
      expect(isErr(r), bad).toBe(true);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("maps a storage error to a retryable external_service failure", async () => {
    const fake = fakeViewStorage({ data: null, error: { message: "bucket exploded" } });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never);
    const r = await gw.createViewUrl(path, { orgId: ORG, jobId: JOB });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.retryable).toBe(true);
      // The provider's own words must not reach the client.
      expect(r.error.message).not.toContain("bucket exploded");
    }
  });

  it("times out rather than hanging the request", async () => {
    const fake = fakeViewStorage({ data: null, error: null }, { hang: true });
    const gw = new SupabasePhotoStorageGateway(() => fake.client as never, 5);
    const r = await gw.createViewUrl(path, { orgId: ORG, jobId: JOB });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.retryable).toBe(true);
  });
});
