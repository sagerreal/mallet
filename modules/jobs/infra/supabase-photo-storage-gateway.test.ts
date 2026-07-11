import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk, isErr } from "@mallet/shared/types";
import { SupabasePhotoStorageGateway, JOB_PHOTOS_BUCKET } from "./supabase-photo-storage-gateway";

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
