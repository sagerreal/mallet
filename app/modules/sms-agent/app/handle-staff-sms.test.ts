import { describe, it, expect, vi } from "vitest";
import { handleStaffSms, type HandleStaffSmsDeps, type TurnResult, type RunTurnInput } from "./handle-staff-sms";
import type { OrgId, UserId } from "@mallet/shared/types";
import type { SmsSession, StaffIdentity } from "../domain/ports";

const ORG = "11111111-1111-1111-1111-111111111111" as OrgId;
const PHONE = "+19255550123";
const STAFF: StaffIdentity = { userId: "22222222-2222-2222-2222-222222222222" as UserId, orgId: ORG, role: "tech", name: "Dee" };

const completed = (text: string): TurnResult => ({ status: "completed", text, transcript: "[T]" });
const needsApproval = (): TurnResult => ({
  status: "needs_approval",
  assistantText: "Sure.",
  pending: [{ toolUseId: "tu_1", tool: "job_complete", summary: "Mark job #42 complete" }],
  transcript: "[T]",
});

function deps(over: Partial<HandleStaffSmsDeps> = {}, session: SmsSession | null = null) {
  const calls: RunTurnInput[] = [];
  const saved: unknown[] = [];
  const sent: string[] = [];
  const base: HandleStaffSmsDeps = {
    staffReader: { findStaffByPhone: vi.fn(async () => STAFF) },
    sessions: { find: vi.fn(async () => session), save: vi.fn(async (s) => void saved.push(s)) },
    runTurn: vi.fn(async (i: RunTurnInput) => {
      calls.push(i);
      return completed("done");
    }),
    reply: { send: vi.fn(async ({ body }) => void sent.push(body)) },
    ...over,
  };
  return { d: base, calls, saved, sent };
}

describe("handleStaffSms", () => {
  it("does nothing for an unrecognised number so the customer path is untouched", async () => {
    const { d } = deps({ staffReader: { findStaffByPhone: vi.fn(async () => null) } });
    const r = await handleStaffSms(d, { fromPhone: PHONE, body: "hello" });

    expect(r).toEqual({ handled: false });
    expect(d.runTurn).not.toHaveBeenCalled();
    expect(d.reply.send).not.toHaveBeenCalled();
    expect(d.sessions.save).not.toHaveBeenCalled();
  });

  it("sends a new instruction to the agent and texts the answer back", async () => {
    const { d, calls, sent } = deps();
    await handleStaffSms(d, { fromPhone: PHONE, body: "what's on my schedule" });

    expect(calls[0]?.userMessage).toBe("what's on my schedule");
    expect(calls[0]?.approvedToolUseIds).toBeUndefined();
    expect(sent).toEqual(["done"]);
  });

  it("asks for confirmation, naming the action, and remembers what it is waiting on", async () => {
    const { d, saved, sent } = deps({ runTurn: vi.fn(async () => needsApproval()) });
    await handleStaffSms(d, { fromPhone: PHONE, body: "job 42 is done" });

    expect(sent[0]).toContain("Mark job #42 complete");
    expect(sent[0]).toContain("Reply YES to confirm");
    expect(saved[0]).toMatchObject({ pendingToolUseIds: ["tu_1"] });
  });

  it("a bare YES approves the exact ids the agent was waiting on", async () => {
    const session: SmsSession = {
      userId: STAFF.userId, phone: PHONE, transcript: "[T]",
      pendingToolUseIds: ["tu_1"], pendingSummary: "Mark job #42 complete",
    };
    const { d, calls } = deps({}, session);
    await handleStaffSms(d, { fromPhone: PHONE, body: "yes" });

    expect(calls[0]?.approvedToolUseIds).toEqual(["tu_1"]);
    expect(calls[0]?.userMessage).toBeUndefined();
  });

  it("a bare NO denies rather than silently dropping the request", async () => {
    const session: SmsSession = {
      userId: STAFF.userId, phone: PHONE, transcript: "[T]",
      pendingToolUseIds: ["tu_1"], pendingSummary: "Mark job #42 complete",
    };
    const { d, calls } = deps({}, session);
    await handleStaffSms(d, { fromPhone: PHONE, body: "no" });

    expect(calls[0]?.deniedToolUseIds).toEqual(["tu_1"]);
    expect(calls[0]?.approvedToolUseIds).toBeUndefined();
  });

  it("a NEW instruction abandons the pending approval instead of carrying it", async () => {
    // The dangerous case: an outstanding "send invoice?" plus a later unrelated "yes" must never
    // combine into a send the staffer had moved on from.
    const session: SmsSession = {
      userId: STAFF.userId, phone: PHONE, transcript: "[T]",
      pendingToolUseIds: ["tu_1"], pendingSummary: "Send invoice #1042",
    };
    const { d, calls, saved } = deps({}, session);
    await handleStaffSms(d, { fromPhone: PHONE, body: "actually what's my schedule" });

    expect(calls[0]?.approvedToolUseIds).toBeUndefined();
    expect(calls[0]?.deniedToolUseIds).toBeUndefined();
    expect(calls[0]?.userMessage).toBe("actually what's my schedule");
    expect(saved[0]).toMatchObject({ pendingToolUseIds: [] });
  });

  it("clears the pending state once a turn completes", async () => {
    const session: SmsSession = {
      userId: STAFF.userId, phone: PHONE, transcript: "[T]",
      pendingToolUseIds: ["tu_1"], pendingSummary: "Mark job #42 complete",
    };
    const { d, saved } = deps({}, session);
    await handleStaffSms(d, { fromPhone: PHONE, body: "yes" });

    expect(saved[0]).toMatchObject({ pendingToolUseIds: [], pendingSummary: null });
  });

  it("saves the conversation BEFORE sending, so a failed send cannot orphan an approval", async () => {
    const order: string[] = [];
    const { d } = deps({
      runTurn: vi.fn(async () => needsApproval()),
      sessions: {
        find: vi.fn(async () => null),
        save: vi.fn(async () => void order.push("save")),
      },
      reply: { send: vi.fn(async () => { order.push("send"); throw new Error("carrier down"); }) },
    });

    await expect(handleStaffSms(d, { fromPhone: PHONE, body: "job 42 done" })).rejects.toThrow();
    expect(order).toEqual(["save", "send"]);
  });

  it("carries the prior transcript so the conversation continues across texts", async () => {
    const session: SmsSession = {
      userId: STAFF.userId, phone: PHONE, transcript: "[EARLIER]",
      pendingToolUseIds: [], pendingSummary: null,
    };
    const { d, calls } = deps({}, session);
    await handleStaffSms(d, { fromPhone: PHONE, body: "and the one after that?" });

    expect(calls[0]?.transcript).toBe("[EARLIER]");
  });
});
