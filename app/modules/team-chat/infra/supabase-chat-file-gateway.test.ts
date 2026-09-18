import { describe, it, expect, vi } from "vitest";
import { asOrgId } from "@mallet/shared/types";
import { SupabaseChatFileGateway, TEAM_FILES_BUCKET, VIEW_URL_TTL_SECONDS } from "./supabase-chat-file-gateway";

const ORG = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const THREAD = "11111111-1111-4111-8111-111111111111";

const clientWith = (overrides: {
  upload?: () => Promise<{ data: unknown; error: unknown }>;
  view?: () => Promise<{ data: unknown; error: unknown }>;
}) => {
  const from = vi.fn(() => ({
    createSignedUploadUrl: overrides.upload ??
      (async () => ({ data: { signedUrl: "https://s/up", token: "tok", path: "p" }, error: null })),
    createSignedUrl: overrides.view ??
      (async () => ({ data: { signedUrl: "https://s/view?sig=abc" }, error: null })),
  }));
  return { client: { storage: { from } } as never, from };
};

describe("SupabaseChatFileGateway.createUploadUrl", () => {
  it("mints an org-and-thread-prefixed key in the team-files bucket", async () => {
    const { client, from } = clientWith({});
    const gw = new SupabaseChatFileGateway(() => client);

    const result = await gw.createUploadUrl({ orgId: ORG, threadId: THREAD, objectId: "obj1", ext: "jpg" });

    expect(from).toHaveBeenCalledWith(TEAM_FILES_BUCKET);
    expect(result.ok && result.value.storagePath).toBe(`${ORG}/${THREAD}/obj1.jpg`);
  });

  it("refuses a type we would not render — an .svg never reaches the bucket", async () => {
    const { client } = clientWith({});
    const gw = new SupabaseChatFileGateway(() => client);
    const result = await gw.createUploadUrl({ orgId: ORG, threadId: THREAD, objectId: "obj1", ext: "svg" });
    expect(result.ok).toBe(false);
  });

  it("refuses a path segment that could climb out of the thread's folder", async () => {
    const { client } = clientWith({});
    const gw = new SupabaseChatFileGateway(() => client);
    for (const objectId of ["../../other", "a/b", "x y"]) {
      const result = await gw.createUploadUrl({ orgId: ORG, threadId: THREAD, objectId, ext: "jpg" });
      expect(result.ok).toBe(false);
    }
  });

  it("maps a provider failure to a generic error — bucket internals never reach the client", async () => {
    const { client } = clientWith({
      upload: async () => ({ data: null, error: { message: "bucket team-files not found: policy xyz" } }),
    });
    const gw = new SupabaseChatFileGateway(() => client);
    const result = await gw.createUploadUrl({ orgId: ORG, threadId: THREAD, objectId: "obj1", ext: "jpg" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).not.toContain("team-files");
  });
});

describe("SupabaseChatFileGateway.createViewUrl", () => {
  it("signs a path inside this thread, with a short expiry", async () => {
    const { client } = clientWith({});
    const gw = new SupabaseChatFileGateway(() => client);
    const path = `${ORG}/${THREAD}/obj1.jpg`;

    const result = await gw.createViewUrl(path, { orgId: ORG, threadId: THREAD });

    expect(result.ok && result.value.url).toBe("https://s/view?sig=abc");
    expect(result.ok && result.value.expiresInSeconds).toBe(VIEW_URL_TTL_SECONDS);
  });

  it("re-validates the prefix: a path from ANOTHER thread or org is refused before signing", async () => {
    const view = vi.fn(async () => ({ data: { signedUrl: "leak" }, error: null }));
    const { client } = clientWith({ view });
    const gw = new SupabaseChatFileGateway(() => client);

    const otherThread = `${ORG}/22222222-2222-4222-8222-222222222222/obj.jpg`;
    const otherOrg = `dddddddd-dddd-4ddd-8ddd-dddddddddddd/${THREAD}/obj.jpg`;
    const traversal = `${ORG}/${THREAD}/../../x/obj.jpg`;

    for (const path of [otherThread, otherOrg, traversal]) {
      const result = await gw.createViewUrl(path, { orgId: ORG, threadId: THREAD });
      expect(result.ok).toBe(false);
    }
    // The point: storage was never even asked.
    expect(view).not.toHaveBeenCalled();
  });

  it("refuses to sign a stored path whose extension is not viewable", async () => {
    const { client } = clientWith({});
    const gw = new SupabaseChatFileGateway(() => client);
    const result = await gw.createViewUrl(`${ORG}/${THREAD}/obj.html`, {
      orgId: ORG,
      threadId: THREAD,
    });
    expect(result.ok).toBe(false);
  });

  it("times out rather than hanging the request", async () => {
    const { client } = clientWith({ view: () => new Promise(() => {}) });
    const gw = new SupabaseChatFileGateway(() => client, 5);
    const result = await gw.createViewUrl(`${ORG}/${THREAD}/obj.jpg`, {
      orgId: ORG,
      threadId: THREAD,
    });
    expect(result.ok).toBe(false);
  });
});
