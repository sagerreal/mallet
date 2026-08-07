/**
 * modules/messaging/app/send-message.test.ts
 *
 * Unit tests for SendMessageUseCase. All dependencies are in-memory fakes —
 * no database, no network, no Twilio. Covers:
 *   - no-number guard returns err without hitting transport or repo
 *   - a2p-not-active guard returns err without hitting transport or repo
 *   - a transport rejection returns err AND marks the claim failed
 *   - a successful send marks the claim sent with the provider SID and returns ok
 *   - a successful send with no externalId marks providerSid=null
 *   - the same idempotency key sends exactly once
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asOrgId, asLeadId, asMessageId } from "@mallet/shared/types";
import type { OrgId, LeadId, AppError } from "@mallet/shared/types";
import { SendMessageUseCase } from "./send-message";
import type { MessageRepository, ClaimOutboundCmd } from "../domain/message-repository";
import { Message } from "../domain/message";
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

// A real (not cast) Message, so the use-case's immutable transitions run for real.
function makeMessage(cmd: ClaimOutboundCmd): Message {
  const created = Message.create({
    id: asMessageId(cmd.id),
    orgId: ORG_ID,
    leadId: cmd.leadId,
    direction: "outbound",
    channel: "sms",
    body: cmd.body,
    fromNumber: cmd.from,
    toNumber: cmd.to,
    providerSid: null,
    status: "queued",
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

// In-memory stand-in for the messages ledger. The Map keyed by idempotency key IS the unique
// index: a second claim on the same key returns the stored row with created:false, exactly as
// `insert ... on conflict do nothing` + the follow-up select does in Postgres.
function makeRepo(): MessageRepository {
  const byKey = new Map<string, Message>();

  const replace = (id: string, next: (m: Message) => Message): void => {
    for (const [key, m] of byKey) {
      if (m.props.id === id) {
        byKey.set(key, next(m));
        return;
      }
    }
    throw new Error(`no claimed message with id ${id}`);
  };

  return {
    claimOutbound: vi.fn().mockImplementation(async (cmd: ClaimOutboundCmd) => {
      const existing = byKey.get(cmd.idempotencyKey);
      if (existing) return { message: existing, created: false };
      const message = makeMessage(cmd);
      byKey.set(cmd.idempotencyKey, message);
      return { message, created: true };
    }),
    markSent: vi.fn().mockImplementation(async (id: string, providerSid: string | null) => {
      replace(id, (m) => m.markSent(providerSid, new Date()));
    }),
    markFailed: vi.fn().mockImplementation(async (id: string, errorCode: string | null) => {
      replace(id, (m) => m.markFailed(errorCode, new Date()));
    }),
    recordInbound: vi.fn(),
    listByLead: vi.fn(),
    findById: vi.fn(),
  } as unknown as MessageRepository;
}

// One id per exec(). Calls after the first get a suffix so a keyless double-send produces two
// distinct rows (and two distinct generated keys), the way a real UUID generator would.
function makeIds(id = "test-msg-id") {
  let n = 0;
  return { newId: vi.fn().mockImplementation(() => (n++ === 0 ? id : `${id}-${n}`)) };
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

  it("sends THROUGH the A2P Messaging Service when the org has one", async () => {
    // Regression. The 7th TwilioSmsSender argument was omitted, so cmd.messagingServiceSid was
    // read by the router, declared on the cmd, and silently dropped — every text went out naming
    // a bare `from`. Carriers check the SERVICE a 10DLC campaign attaches to, so a bare number is
    // filtered as unregistered traffic even with an approved campaign. The failure is invisible
    // from inside the app: Twilio accepts the send and the handset never rings.
    const transport = vi.fn(async () => ({ sid: "SM_svc" }));
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    await uc.exec({ ...BASE_CMD, messagingServiceSid: "MG_test_service" });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ messagingServiceSid: "MG_test_service" }),
    );
  });

  it("omits the Messaging Service when the org has none, rather than sending undefined", async () => {
    const transport = vi.fn(async () => ({ sid: "SM_bare" }));
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    await uc.exec({ ...BASE_CMD, messagingServiceSid: null });

    expect(transport).toHaveBeenCalledWith(
      expect.not.objectContaining({ messagingServiceSid: expect.anything() }),
    );
  });

  it("returns err immediately when orgTwilioNumber is null — transport and repo are never called", async () => {
    const transport = vi.fn();
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec({ ...BASE_CMD, orgTwilioNumber: null });

    expect(result.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    // A precondition failure must never burn the caller's key — nothing is claimed.
    expect(vi.mocked(repo.claimOutbound)).not.toHaveBeenCalled();
  });

  it("returns err immediately when a2pActive is false — transport and repo are never called", async () => {
    const transport = vi.fn();
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const result = await uc.exec({ ...BASE_CMD, a2pActive: false });

    expect(result.ok).toBe(false);
    const error = (result as { ok: false; error: AppError }).error;
    expect(error.kind).toBe("conflict");
    expect(transport).not.toHaveBeenCalled();
    expect(vi.mocked(repo.claimOutbound)).not.toHaveBeenCalled();
  });

  it("a precondition failure leaves the key usable — a later send with the same key still goes out", async () => {
    // The whole point of claiming AFTER the guards: an org that hasn't finished 10DLC yet must not
    // have its follow-up key consumed by the attempt that never reached Twilio.
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: FAKE_SID });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());
    const cmd = { ...BASE_CMD, idempotencyKey: "okq-e1-fu1" };

    const blocked = await uc.exec({ ...cmd, a2pActive: false });
    const later = await uc.exec(cmd);

    expect(blocked.ok).toBe(false);
    expect(later.ok).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("returns err and marks the claim failed when the transport rejects the send", async () => {
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
    // The claim is settled as failed, never left dangling at "queued" and never marked sent.
    expect(vi.mocked(repo.markFailed)).toHaveBeenCalledOnce();
    expect(vi.mocked(repo.markSent)).not.toHaveBeenCalled();
  });

  it("marks status:'sent' with the provider SID and returns ok on a successful send", async () => {
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: FAKE_SID });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds("the-msg-id"));

    const result = await uc.exec(BASE_CMD);

    expect(result.ok).toBe(true);
    expect(vi.mocked(repo.claimOutbound)).toHaveBeenCalledOnce();
    const claim = vi.mocked(repo.claimOutbound).mock.calls[0]![0];
    expect(claim.body).toBe(BODY);
    expect(claim.from).toBe(ORG_NUMBER);
    expect(claim.to).toBe(LEAD_PHONE);
    expect(vi.mocked(repo.markSent)).toHaveBeenCalledWith("the-msg-id", FAKE_SID);
    const message = (result as { ok: true; value: Message }).value;
    expect(message.props.status).toBe("sent");
    expect(message.props.providerSid).toBe(FAKE_SID);
  });

  it("marks providerSid=null when the receipt carries no externalId (undefined)", async () => {
    // Simulate a receipt where externalId is undefined (e.g., a stub transport that omits the sid).
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: undefined as unknown as string });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds("the-msg-id"));

    const result = await uc.exec(BASE_CMD);

    expect(result.ok).toBe(true);
    // externalId will be undefined inside the receipt → ?? null yields null.
    expect(vi.mocked(repo.markSent)).toHaveBeenCalledWith("the-msg-id", null);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  it("sends once for the same idempotency key", async () => {
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: FAKE_SID });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());
    const cmd = { ...BASE_CMD, idempotencyKey: "okq-e1-fu1" };

    const first = await uc.exec(cmd);
    const second = await uc.exec(cmd);

    expect(transport).toHaveBeenCalledOnce();
    expect(second.ok && second.value.props.id).toBe(first.ok && first.value.props.id);
    expect(second.ok && second.value.props.status).toBe("sent");
  });

  it("marks the claim failed when Twilio rejects, and does not resend on retry", async () => {
    const transport: SmsTransport = vi.fn().mockRejectedValue(
      Object.assign(new Error("twilio rejection"), { status: 400, code: 21211 }),
    );
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());
    const cmd = { ...BASE_CMD, idempotencyKey: "okq-e1-fu1" };

    const first = await uc.exec(cmd);
    expect(first.ok).toBe(false);

    // Same key: the claim is already settled as failed, so nothing goes to Twilio a second time.
    const second = await uc.exec(cmd);

    expect(transport).toHaveBeenCalledOnce();
    expect(second.ok).toBe(false);
    expect((second as { ok: false; error: AppError }).error.kind).toBe("conflict");
  });

  it("keyless sends are independent — each one gets its own generated key and goes out", async () => {
    // Today's behaviour, unchanged: with no caller key, two sends are two texts.
    const transport: SmsTransport = vi.fn().mockResolvedValue({ sid: FAKE_SID });
    const uc = new SendMessageUseCase(repo, makeSmsDeps(transport), makeIds());

    const first = await uc.exec(BASE_CMD);
    const second = await uc.exec(BASE_CMD);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(first.ok && second.ok && first.value.props.id).not.toBe(second.ok && second.value.props.id);
    const keys = vi.mocked(repo.claimOutbound).mock.calls.map((c) => c[0]!.idempotencyKey);
    expect(keys[0]).toMatch(/^msg-/);
    expect(keys[1]).toMatch(/^msg-/);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
