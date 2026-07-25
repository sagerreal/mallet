import { describe, it, expect, beforeEach } from "vitest";
import { isOk, asUserId, asPhone, type Phone, type UserId } from "@mallet/shared/types";
import type { AgentNumberStore } from "../domain/call-directory";
import { SetCallbackNumberUseCase } from "./set-callback-number";

const USER = asUserId("44444444-4444-4444-4444-444444444444");
const AGENT = asPhone("+17813850591");

class FakeAgentNumbers implements AgentNumberStore {
  public saved: { userId: UserId; number: Phone | null }[] = [];
  constructor(private stored: Phone | null = null) {}
  async find(): Promise<Phone | null> {
    return this.stored;
  }
  async save(userId: UserId, number: Phone | null): Promise<void> {
    this.saved.push({ userId, number });
    this.stored = number;
  }
}

describe("SetCallbackNumberUseCase", () => {
  let agents: FakeAgentNumbers;
  let useCase: SetCallbackNumberUseCase;

  beforeEach(() => {
    agents = new FakeAgentNumbers();
    useCase = new SetCallbackNumberUseCase(agents);
  });

  it("normalises a typed number to E.164 before storing it", async () => {
    const r = await useCase.exec({ userId: USER, callbackNumber: "(781) 385-0591" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(AGENT);
    expect(agents.saved).toEqual([{ userId: USER, number: AGENT }]);
  });

  it("clears the number when given null — an explicit clear, not a silent no-op", async () => {
    const r = await useCase.exec({ userId: USER, callbackNumber: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBeNull();
    expect(agents.saved).toEqual([{ userId: USER, number: null }]);
  });

  it("treats a blank string as a clear", async () => {
    await useCase.exec({ userId: USER, callbackNumber: "   " });
    expect(agents.saved).toEqual([{ userId: USER, number: null }]);
  });

  it("rejects an unparseable number and writes nothing", async () => {
    const r = await useCase.exec({ userId: USER, callbackNumber: "12" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("phone");
    expect(agents.saved).toHaveLength(0);
  });

  it("writes only the user it was given", async () => {
    const other = asUserId("55555555-5555-5555-5555-555555555555");
    await useCase.exec({ userId: other, callbackNumber: "781-385-0591" });
    expect(agents.saved[0]!.userId).toBe(other);
  });
});
