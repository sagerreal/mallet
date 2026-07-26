/**
 * modules/messaging/app/send-message.test.ts
 *
 * Unit tests for SendMessageUseCase. All dependencies are in-memory fakes —
 * no database, no network, no Twilio. Covers:
 *   - no-number guard returns err without hitting transport or repo
 *   - a2p-not-active guard returns err without hitting transport or repo
 *   - a transport rejection returns err AND does NOT call recordOutbound
 *   - a successful send records status:"sent" with the provider SID and returns ok
 *   - a successful send with no externalId records providerSid=null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asOrgId, asLeadId } from "@mallet/shared/types";
import type { OrgId, LeadId, AppError } from "@mallet/shared/types";
import { SendMessageUseCase } from "./send-message";
import type { MessageRepository, RecordOutboundInput } from "../domain/message-repository";
import type { Message } from "../domain/message";
import type { SmsTransport } from "../../notifications/infra/twilio-sms-sender";
import type { SendMessageDeps, SendMessageCmd } from "./send-message";

// ── Constants ──────────────────────────────────────────────────────────────────

const ORG_ID: OrgId = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const LEAD_ID: LeadId = asLeadId("bbbbbbbb-bbbb-4bbb-4bbb-bbbbbbbbbbbb");
const ORG_NUMBER = "+15005550006";
const LEAD_PHONE = "+15555550199";
const BODY = "Hello!";
const FAKE_SID = "SM_test_sid";

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeMessage(input: RecordOutboundInput): Message {
  return {
    props: {
      id: input.id,
      orgId: ORG_ID,
      leadId: input.leadId,
      direction: "outbound",
      channel: "sms",
      body: input.body,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      providerSid: input.providerSid,
      status: input.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as Message;
}

function makeRepo(): MessageRepository {
  return {
    recordOutbound: vi.fn().mockImplementation(async (input: RecordOutboundInput) => makeMessage(input)),
    recordInbound: vi.fn(),
    listByLead: vi.fn(),
    findById: vi.fn(),
  } as unknown as MessageRepository;
}

function makeIds(id = "test-msg-id") {
  return { newId: vi.fn().mockReturnValue(id) };
}

function makeSmsDeps(transport: SmsTransport): SendMessageDeps {
  return {
    accountSid: "ACtest",
    authToken: "auth_test",
    clock: { now: () => new Date("2026-07-09T12:00:00Z") },
    transport,
  };
}

const BASE_CMD: SendMessageCmd = {
  orgId: ORG_ID,
  orgTwilioNumber: ORG_NUMBER,
  a2pActive: true,
  messagingServiceSid: null,
  leadId: LEAD_ID,
  leadPhone: LEAD_PHONE,
  body: BODY,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("SendMessageUseCase", () => {
  let repo: MessageRepository;

  beforeEach(() => {
    repo = makeRepo();
  });

  it("returns err immediately when orgTwilioNumber is null — transport and repo are never called", async () => {
    const transport = vi.fn();
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec({ ...BASE_CMD, orgTwilioNumber: null });

    expect(result.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(vi.mocked(repo.recordOutbound)).not.toHaveBeenCalled();
  });

  it("returns err immediately when a2pActive is false — transport and repo are never called", async () => {
    const transport = vi.fn();
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec({ ...BASE_CMD, a2pActive: false });

    expect(result.ok).toBe(false);
    const error = (result as { ok: false; error: AppError }).error;
    expect(error.kind).toBe("conflict");
    expect(transport).not.toHaveBeenCalled();
    expect(vi.mocked(repo.recordOutbound)).not.toHaveBeenCalled();
  });

  it("returns err and does NOT call recordOutbound when the transport rejects the send", async () => {
    // Transport throws a 4xx-style Twilio error so TwilioSmsSender returns err(externalService(...)).
    const transport: SmsTransport = vi.fn().mockRejectedValue(
      Object.assign(new Error("twilio rejection"), { status: 400, code: 21211 }),
    );
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec(BASE_CMD);

    expect(result.ok).toBe(false);
    // The error must be an AppError-shaped object (kind: external_service).
    const error = (result as { ok: false; error: AppError }).error;
    expect(error.kind).toBe("external_service");
    // No row was persisted.
    expect(vi.mocked(repo.recordOutbound)).not.toHaveBeenCalled();
  });

  it("records status:'sent' with the provider SID and returns ok on a successful send", async () => {
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: FAKE_SID });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds("the-msg-id"));

    const result = await uc.exec(BASE_CMD);

    expect(result.ok).toBe(true);
    expect(vi.mocked(repo.recordOutbound)).toHaveBeenCalledOnce();
    const call = vi.mocked(repo.recordOutbound).mock.calls[0]![0];
    expect(call.status).toBe("sent");
    expect(call.providerSid).toBe(FAKE_SID);
    expect(call.body).toBe(BODY);
    expect(call.fromNumber).toBe(ORG_NUMBER);
    expect(call.toNumber).toBe(LEAD_PHONE);
  });

  it("records providerSid=null when the receipt carries no externalId (undefined)", async () => {
    // Simulate a receipt where externalId is undefined (e.g., a stub transport that omits the sid).
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: undefined as unknown as string });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec(BASE_CMD);

    expect(result.ok).toBe(true);
    const call = vi.mocked(repo.recordOutbound).mock.calls[0]![0];
    // externalId will be undefined inside the receipt → ?? null yields null.
    expect(call.providerSid).toBeNull();
  });
});
