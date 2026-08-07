/**
 * modules/messaging/app/record-inbound-message.test.ts
 *
 * Unit tests for RecordInboundMessageUseCase. All dependencies are in-memory fakes —
 * no database, no network, no Twilio. Covers:
 *   - basic recording with matched lead
 *   - recording with no matched lead (leadId=null, no unread marker called)
 *   - body truncation at 1600 chars
 *   - inbound from known lead flips unread=true (the loop-completion requirement)
 *   - unread marker is idempotent-safe (called once per exec, not twice)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asLeadId, asOrgId, asMessageId } from "@mallet/shared/types";
import type { LeadId } from "@mallet/shared/types";
import { RecordInboundMessageUseCase } from "./record-inbound-message";
import type { MessageRepository, LeadByPhoneReader, LeadUnreadMarker } from "../domain/message-repository";
import type { Message } from "../domain/message";
import type { RecordInboundInput } from "../domain/message-repository";

// ── Fakes ──────────────────────────────────────────────────────────────────────

const ORG_ID = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const LEAD_ID = asLeadId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const MSG_ID = asMessageId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

function makeMessage(input: RecordInboundInput): Message {
  return {
    props: {
      id: MSG_ID,
      orgId: ORG_ID,
      leadId: input.leadId,
      direction: "inbound",
      channel: "sms",
      body: input.body,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      providerSid: input.providerSid,
      status: "received",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as Message;
}

function makeRepo(): MessageRepository {
  return {
    recordInbound: vi.fn().mockImplementation(async (input: RecordInboundInput) => makeMessage(input)),
    listByLead: vi.fn(),
    findById: vi.fn(),
  } as unknown as MessageRepository;
}

function makeLeadReader(leadId: LeadId | null): LeadByPhoneReader {
  return {
    findLeadByPhone: vi.fn().mockResolvedValue(leadId ? { leadId } : null),
  };
}

function makeIdGenerator(id: string) {
  return { newId: vi.fn().mockReturnValue(id) };
}

function makeUnreadMarker(): LeadUnreadMarker {
  return { markLeadUnread: vi.fn().mockResolvedValue(true) };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

const BASE_CMD = {
  orgId: ORG_ID,
  fromPhone: "+15555550199",
  toPhone: "+15005550006",
  body: "Hello!",
  providerSid: "SMtest",
} as const;

describe("RecordInboundMessageUseCase", () => {
  let repo: MessageRepository;
  let unreadMarker: LeadUnreadMarker;

  beforeEach(() => {
    repo = makeRepo();
    unreadMarker = makeUnreadMarker();
  });

  it("records the message with the matched leadId", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(LEAD_ID),
      makeIdGenerator("new-id"),
      unreadMarker,
    );

    const msg = await uc.exec(BASE_CMD);

    expect(vi.mocked(repo.recordInbound)).toHaveBeenCalledOnce();
    const call = vi.mocked(repo.recordInbound).mock.calls[0]![0];
    expect(call.leadId).toBe(LEAD_ID);
    expect(call.body).toBe("Hello!");
    expect(msg.props.direction).toBe("inbound");
  });

  it("records with leadId=null when phone is not matched — unread marker is NOT called", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(null),
      makeIdGenerator("new-id-2"),
      unreadMarker,
    );

    await uc.exec(BASE_CMD);

    const call = vi.mocked(repo.recordInbound).mock.calls[0]![0];
    expect(call.leadId).toBeNull();
    // No lead matched → unread marker must never fire.
    expect(vi.mocked(unreadMarker.markLeadUnread)).not.toHaveBeenCalled();
  });

  it("truncates body at 1600 chars", async () => {
    const longBody = "x".repeat(1700);
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(null),
      makeIdGenerator("new-id-3"),
    );

    await uc.exec({ ...BASE_CMD, body: longBody });

    const call = vi.mocked(repo.recordInbound).mock.calls[0]![0];
    expect(call.body.length).toBe(1600);
  });

  it("marks the matched lead unread after recording (inbound completes the loop)", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(LEAD_ID),
      makeIdGenerator("new-id-4"),
      unreadMarker,
    );

    await uc.exec(BASE_CMD);

    expect(vi.mocked(unreadMarker.markLeadUnread)).toHaveBeenCalledOnce();
    const [calledLeadId] = vi.mocked(unreadMarker.markLeadUnread).mock.calls[0]!;
    expect(calledLeadId).toBe(LEAD_ID);
  });

  it("is idempotent-safe: markLeadUnread is called exactly once per exec, not twice", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(LEAD_ID),
      makeIdGenerator("new-id-5"),
      unreadMarker,
    );

    await uc.exec(BASE_CMD);

    expect(vi.mocked(unreadMarker.markLeadUnread)).toHaveBeenCalledTimes(1);
  });

  it("works without an unreadMarker (optional parameter omitted)", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(LEAD_ID),
      makeIdGenerator("new-id-6"),
      // no unreadMarker supplied — should not throw
    );

    await expect(uc.exec(BASE_CMD)).resolves.not.toThrow();
  });

  it("stores the providerSid on the recorded message", async () => {
    const uc = new RecordInboundMessageUseCase(
      repo,
      makeLeadReader(LEAD_ID),
      makeIdGenerator("new-id-7"),
    );

    await uc.exec({ ...BASE_CMD, providerSid: "SM_specific_sid" });

    const call = vi.mocked(repo.recordInbound).mock.calls[0]![0];
    expect(call.providerSid).toBe("SM_specific_sid");
  });
});
