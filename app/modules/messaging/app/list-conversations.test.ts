/**
 * modules/messaging/app/list-conversations.test.ts
 *
 * Unit tests for ListConversationsUseCase. All dependencies are in-memory fakes —
 * no database, no network. Covers:
 *   - delegates to repo.listConversations without a filter when no leadId provided
 *   - passes filter.leadId through when a leadId is supplied
 *   - returns whatever the repo resolves (delegation, not transformation)
 *   - empty result from repo is returned as-is
 *   - one ConversationRow per lead in the result
 *   - result preserves repo order (repo is authoritative for newest-first sorting)
 */

import { describe, it, expect, vi } from "vitest";
import { asLeadId, asOrgId, asUserId } from "@mallet/shared/types";
import type { LeadId } from "@mallet/shared/types";
import { ListConversationsUseCase } from "./list-conversations";
import type { MessageRepository } from "../domain/message-repository";
import type { ConversationRow } from "../domain/message-repository";

// ── Constants ──────────────────────────────────────────────────────────────────

const ORG_ID = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const LEAD_ID_A: LeadId = asLeadId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const LEAD_ID_B: LeadId = asLeadId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    leadId: LEAD_ID_A,
    leadName: "Alice",
    phone: "555-0101",
    lastBody: "Hello!",
    lastDirection: "inbound",
    lastAt: new Date("2026-07-01T10:00:00Z"),
    unread: true,
    ...overrides,
  };
}

function makeRepo(conversations: ConversationRow[] = []): MessageRepository {
  return {
    listConversations: vi.fn().mockResolvedValue(conversations),
    listByLead: vi.fn(),
    recordInbound: vi.fn(),
    claimOutbound: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    findById: vi.fn(),
  } as unknown as MessageRepository;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ListConversationsUseCase", () => {
  it("calls repo.listConversations with no filter when no leadId is provided", async () => {
    const repo = makeRepo();
    const uc = new ListConversationsUseCase(repo);

    await uc.exec({});

    expect(vi.mocked(repo.listConversations)).toHaveBeenCalledOnce();
    const [filter] = vi.mocked(repo.listConversations).mock.calls[0]!;
    expect(filter).toBeUndefined();
  });

  it("passes filter.leadId to the repo when a leadId is supplied", async () => {
    const repo = makeRepo();
    const uc = new ListConversationsUseCase(repo);

    await uc.exec({ leadId: LEAD_ID_A });

    expect(vi.mocked(repo.listConversations)).toHaveBeenCalledOnce();
    const [filter] = vi.mocked(repo.listConversations).mock.calls[0]!;
    expect(filter).toEqual({ leadId: LEAD_ID_A });
  });

  it("passes the tech scope through — assignedToUserId reaches the repo verbatim", async () => {
    const repo = makeRepo();
    const uc = new ListConversationsUseCase(repo);
    const techId = asUserId("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

    await uc.exec({ assignedToUserId: techId });

    const [filter] = vi.mocked(repo.listConversations).mock.calls[0]!;
    expect(filter).toEqual({ assignedToUserId: techId });
  });

  it("returns whatever the repo resolves without transformation", async () => {
    const conv = makeConversation();
    const repo = makeRepo([conv]);
    const uc = new ListConversationsUseCase(repo);

    const result = await uc.exec({});

    expect(result).toStrictEqual([conv]);
  });

  it("returns an empty array when the repo resolves with no conversations", async () => {
    const repo = makeRepo([]);
    const uc = new ListConversationsUseCase(repo);

    const result = await uc.exec({});

    expect(result).toHaveLength(0);
    expect(result).toStrictEqual([]);
  });

  it("preserves the repo's ordering (newest-first is the repo's responsibility)", async () => {
    const newer = makeConversation({
      leadId: LEAD_ID_A,
      leadName: "Alice",
      lastAt: new Date("2026-07-02T12:00:00Z"),
    });
    const older = makeConversation({
      leadId: LEAD_ID_B,
      leadName: "Bob",
      lastAt: new Date("2026-07-01T08:00:00Z"),
    });
    // Repo returns newest-first (as the real impl does).
    const repo = makeRepo([newer, older]);
    const uc = new ListConversationsUseCase(repo);

    const result = await uc.exec({});

    expect(result).toHaveLength(2);
    expect(result[0]!.leadId).toBe(LEAD_ID_A);
    expect(result[1]!.leadId).toBe(LEAD_ID_B);
  });

  it("returns one row per lead (repo is responsible for deduplication)", async () => {
    const convA = makeConversation({ leadId: LEAD_ID_A, leadName: "Alice" });
    const convB = makeConversation({ leadId: LEAD_ID_B, leadName: "Bob" });
    const repo = makeRepo([convA, convB]);
    const uc = new ListConversationsUseCase(repo);

    const result = await uc.exec({});

    const leadIds = result.map((r) => r.leadId);
    expect(leadIds).toHaveLength(2);
    // All lead IDs are unique — one row per lead.
    expect(new Set(leadIds).size).toBe(2);
  });

  it("surfaces the correct lastDirection for an outbound message", async () => {
    const conv = makeConversation({ lastDirection: "outbound", unread: false });
    const repo = makeRepo([conv]);
    const uc = new ListConversationsUseCase(repo);

    const [result] = await uc.exec({});

    expect(result!.lastDirection).toBe("outbound");
    expect(result!.unread).toBe(false);
  });
});
