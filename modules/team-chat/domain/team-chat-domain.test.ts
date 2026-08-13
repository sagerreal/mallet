import { describe, it, expect } from "vitest";
import { asOrgId, asUserId } from "@mallet/shared/types";
import { TeamThread, dmKeyFor, MAX_GROUP_TITLE } from "./team-thread";
import { TeamMessage, MAX_CHAT_BODY, MAX_CHAT_FILE_BYTES } from "./team-message";

const ORG = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const DANA = asUserId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const MIKE = asUserId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const NOW = new Date("2026-08-13T17:00:00Z");

describe("dmKeyFor", () => {
  it("is symmetric — the same two people always resolve to the same conversation", () => {
    // This is the whole reason a DM cannot fork: the key does not depend on who tapped first.
    expect(dmKeyFor(DANA, MIKE)).toBe(dmKeyFor(MIKE, DANA));
  });

  it("distinguishes different pairs", () => {
    const other = asUserId("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(dmKeyFor(DANA, MIKE)).not.toBe(dmKeyFor(DANA, other));
  });
});

const thread = (over: Partial<Parameters<typeof TeamThread.create>[0]> = {}) =>
  TeamThread.create({
    id: "11111111-1111-4111-8111-111111111111",
    orgId: ORG,
    kind: "dm",
    title: null,
    dmKey: dmKeyFor(DANA, MIKE),
    jobId: null,
    createdByUserId: DANA,
    lastMessageAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

describe("TeamThread", () => {
  it("a DM needs its key and carries no title", () => {
    expect(thread().ok).toBe(true);
    expect(thread({ dmKey: null }).ok).toBe(false);
    expect(thread({ title: "Nope" }).ok).toBe(false);
  });

  it("a group needs a name and carries no dm key", () => {
    expect(thread({ kind: "group", title: "Friday van checks", dmKey: null }).ok).toBe(true);
    expect(thread({ kind: "group", title: null, dmKey: null }).ok).toBe(false);
    expect(thread({ kind: "group", title: "  ", dmKey: null }).ok).toBe(false);
    expect(thread({ kind: "group", title: "Has a key", dmKey: "x:y" }).ok).toBe(false);
  });

  it("trims a group name and bounds its length", () => {
    const trimmed = thread({ kind: "group", title: "  Repipe crew  ", dmKey: null });
    expect(trimmed.ok && trimmed.value.props.title).toBe("Repipe crew");
    const tooLong = thread({ kind: "group", title: "x".repeat(MAX_GROUP_TITLE + 1), dmKey: null });
    expect(tooLong.ok).toBe(false);
  });
});

const message = (over: Partial<Parameters<typeof TeamMessage.create>[0]> = {}) =>
  TeamMessage.create({
    id: "22222222-2222-4222-8222-222222222222",
    orgId: ORG,
    threadId: "11111111-1111-4111-8111-111111111111",
    authorUserId: DANA,
    body: "bringing the 40 gal",
    attachment: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

describe("TeamMessage", () => {
  it("takes words, or a photo, or both — but never nothing", () => {
    expect(message().ok).toBe(true);
    expect(message({ body: "   " }).ok).toBe(false);
    // A photo with no caption is a complete message.
    const photoOnly = message({
      body: "",
      attachment: { path: `${ORG}/t/p.jpg`, mediaType: "image/jpeg", bytes: 2048 },
    });
    expect(photoOnly.ok).toBe(true);
  });

  it("trims the body", () => {
    const m = message({ body: "  on my way  " });
    expect(m.ok && m.value.props.body).toBe("on my way");
  });

  it("bounds the body length", () => {
    expect(message({ body: "x".repeat(MAX_CHAT_BODY) }).ok).toBe(true);
    expect(message({ body: "x".repeat(MAX_CHAT_BODY + 1) }).ok).toBe(false);
  });

  it("refuses an attachment that is not one of the three image types", () => {
    const bad = message({
      attachment: {
        path: `${ORG}/t/x.svg`,
        // An SVG renders script in a browser — the reason the set is closed.
        mediaType: "image/svg+xml" as never,
        bytes: 100,
      },
    });
    expect(bad.ok).toBe(false);
  });

  it("refuses an empty or oversized attachment", () => {
    const zero = message({
      attachment: { path: `${ORG}/t/p.jpg`, mediaType: "image/jpeg", bytes: 0 },
    });
    const huge = message({
      attachment: {
        path: `${ORG}/t/p.jpg`,
        mediaType: "image/jpeg",
        bytes: MAX_CHAT_FILE_BYTES + 1,
      },
    });
    expect(zero.ok).toBe(false);
    expect(huge.ok).toBe(false);
  });
});
