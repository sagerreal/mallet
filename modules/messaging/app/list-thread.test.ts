/**
 * modules/messaging/app/list-thread.test.ts
 *
 * Unit tests for ListThreadUseCase. All dependencies are in-memory fakes —
 * no database, no network. Covers:
 *   - delegates to repo.listByLead with the caller-supplied leadId
 *   - default limit is 50 when cmd.limit is omitted
 *   - default offset is 0 when cmd.offset is omitted
 *   - explicit limit and offset are forwarded unchanged
 *   - returns whatever the repo resolves (delegation, not transformation)
 *   - empty result from repo is returned as-is
 */

import { describe, it, expect, vi } from "vitest";
import { asLeadId, asOrgId, asMessageId } from "@mallet/shared/types";
import type { LeadId } from "@mallet/shared/types";
import { ListThreadUseCase } from "./list-thread";
import type { MessageRepository } from "../domain/message-repository";
import type { Message } from "../domain/message";

// ── Constants ──────────────────────────────────────────────────────────────────

const ORG_ID = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const LEAD_ID: LeadId = asLeadId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const MSG_ID = asMessageId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeFakeMessage(): Message {
  return {
    props: {
      id: MSG_ID,
      orgId: ORG_ID,
      leadId: LEAD_ID,
      direction: "inbound",
      channel: "sms",
      body: "Hello!",
      fromNumber: "+15555550199",
      toNumber: "+15005550006",
      providerSid: "SMtest",
      status: "received",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as Message;
}

function makeRepo(messages: Message[] = []): MessageRepository {
  return {
    listByLead: vi.fn().mockResolvedValue(messages),
    recordInbound: vi.fn(),
    recordOutbound: vi.fn(),
    findById: vi.fn(),
  } as unknown as MessageRepository;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ListThreadUseCase", () => {
  it("delegates to repo.listByLead with the supplied leadId", async () => {
    const repo = makeRepo([makeFakeMessage()]);
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID });

    expect(vi.mocked(repo.listByLead)).toHaveBeenCalledOnce();
    const [calledLeadId] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(calledLeadId).toBe(LEAD_ID);
  });

  it("defaults limit to 50 when cmd.limit is omitted", async () => {
    const repo = makeRepo();
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID });

    const [, page] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(page.limit).toBe(50);
  });

  it("defaults offset to 0 when cmd.offset is omitted", async () => {
    const repo = makeRepo();
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID });

    const [, page] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(page.offset).toBe(0);
  });

  it("forwards an explicit limit to the repo unchanged", async () => {
    const repo = makeRepo();
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID, limit: 100 });

    const [, page] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(page.limit).toBe(100);
  });

  it("forwards an explicit offset to the repo unchanged", async () => {
    const repo = makeRepo();
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID, offset: 25 });

    const [, page] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(page.offset).toBe(25);
  });

  it("forwards explicit limit AND offset together, neither defaulted", async () => {
    const repo = makeRepo();
    const uc = new ListThreadUseCase(repo);

    await uc.exec({ leadId: LEAD_ID, limit: 10, offset: 30 });

    const [, page] = vi.mocked(repo.listByLead).mock.calls[0]!;
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(30);
  });

  it("returns the messages resolved by the repo without transformation", async () => {
    const fakeMsg = makeFakeMessage();
    const repo = makeRepo([fakeMsg]);
    const uc = new ListThreadUseCase(repo);

    const result = await uc.exec({ leadId: LEAD_ID });

    expect(result).toStrictEqual([fakeMsg]);
  });

  it("returns an empty array when the repo resolves with no messages", async () => {
    const repo = makeRepo([]);
    const uc = new ListThreadUseCase(repo);

    const result = await uc.exec({ leadId: LEAD_ID });

    expect(result).toHaveLength(0);
    expect(result).toStrictEqual([]);
  });
});
