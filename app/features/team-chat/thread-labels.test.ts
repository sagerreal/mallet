/**
 * features/team-chat/thread-labels.test.ts
 * What a conversation is called and what its preview line says — the rules the inbox reads by.
 */
import { describe, it, expect } from "vitest";
import { initialsOf, threadTitle, previewOf } from "./thread-labels";
import type { TeamThreadDTO } from "@mallet/team-chat";

const ME = "11111111-1111-4111-8111-111111111111";
const MIKE = "22222222-2222-4222-8222-222222222222";

const dm = (over: Partial<TeamThreadDTO> = {}): TeamThreadDTO =>
  ({
    id: "t1",
    kind: "dm",
    title: null,
    lastMessageAt: "2026-08-13T17:00:00.000Z",
    lastBody: "bringing the 40 gal",
    lastAuthorUserId: MIKE,
    lastHadAttachment: false,
    unreadCount: 0,
    members: [
      { userId: ME, name: "Dana Alvarez" },
      { userId: MIKE, name: "Mike Rivera" },
    ],
    ...over,
  }) as TeamThreadDTO;

describe("initialsOf", () => {
  it("takes initials from a name, and from an email when there is no name", () => {
    expect(initialsOf("Mike Rivera")).toBe("MR");
    expect(initialsOf("mike.rivera@shop.com")).toBe("MR");
    expect(initialsOf("alice")).toBe("AL");
    expect(initialsOf("")).toBe("??");
  });
});

describe("threadTitle", () => {
  it("names a DM after the OTHER person, never the reader", () => {
    expect(threadTitle(dm(), ME)).toBe("Mike Rivera");
    expect(threadTitle(dm(), MIKE)).toBe("Dana Alvarez");
  });

  it("names a group after itself", () => {
    expect(threadTitle(dm({ kind: "group", title: "Friday van checks" }), ME)).toBe(
      "Friday van checks",
    );
  });
});

describe("previewOf", () => {
  it("prefixes MY last message with 'You:' and leaves a teammate's plain", () => {
    expect(previewOf(dm({ lastAuthorUserId: ME }), ME)).toBe("You: bringing the 40 gal");
    expect(previewOf(dm(), ME)).toBe("bringing the 40 gal");
  });

  it("says Photo when the last message was an image with no caption", () => {
    expect(previewOf(dm({ lastBody: "", lastHadAttachment: true }), ME)).toBe("Photo");
  });

  it("says so plainly when nothing has been said yet", () => {
    expect(previewOf(dm({ lastBody: "", lastHadAttachment: false }), ME)).toBe("No messages yet");
  });

  it("truncates a long line rather than letting it push the timestamp off the row", () => {
    const long = previewOf(dm({ lastBody: "x".repeat(200) }), ME);
    expect(long.length).toBeLessThanOrEqual(73);
    expect(long.endsWith("…")).toBe(true);
  });
});
