import { describe, it, expect } from "vitest";
import { BuildAssistantUseCase } from "./build-assistant";
import type { SettingsReader, LeadSummaryReader, VoiceToolSpec } from "../domain/assistant";
import type { LeadByPhoneReader } from "@mallet/messaging/domain/message-repository";
import { OrgSettings } from "@mallet/settings/domain/org-settings";
import { baseSettingsProps } from "@mallet/settings/domain/org-settings.fixtures";
import { asOrgId, asLeadId, isOk, isErr } from "@mallet/shared/types";
import type { OrgId, LeadId } from "@mallet/shared/types";
import { VOICE_MODEL, VOICE, MAX_CALL_MINUTES } from "../infra/vapi-defaults";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");

// Build a valid OrgSettings from the settings fixture, overriding fields as needed.
const settingsFor = (o: Partial<Parameters<typeof baseSettingsProps>[0]> = {}): OrgSettings => {
  const r = OrgSettings.create(baseSettingsProps({ orgId: ORG, brandName: "Bayline Plumbing", ...o }));
  if (!r.ok) throw new Error("fixture invalid");
  return r.value;
};

// --- fakes with call counters (N+1 guard) --------------------------------

class FakeSettingsReader implements SettingsReader {
  calls = 0;
  constructor(private readonly result: OrgSettings | null) {}
  async getByOrg(_orgId: OrgId): Promise<OrgSettings | null> {
    this.calls += 1;
    return this.result;
  }
}

class FakeLeadByPhone implements LeadByPhoneReader {
  calls = 0;
  lastArg: string | null = null;
  constructor(private readonly hit: { leadId: LeadId } | null) {}
  async findLeadByPhone(phoneE164: string): Promise<{ leadId: LeadId } | null> {
    this.calls += 1;
    this.lastArg = phoneE164;
    return this.hit;
  }
}

class FakeLeadSummary implements LeadSummaryReader {
  calls = 0;
  lastArg: LeadId | null = null;
  constructor(private readonly summary: { name: string; openWork: string | null } | null) {}
  async summarize(leadId: LeadId): Promise<{ name: string; openWork: string | null } | null> {
    this.calls += 1;
    this.lastArg = leadId;
    return this.summary;
  }
}

const TOOLS: readonly VoiceToolSpec[] = [];

const makeUseCase = (deps: {
  settings: SettingsReader;
  leadByPhone: LeadByPhoneReader;
  leadSummary: LeadSummaryReader;
}) => new BuildAssistantUseCase(deps, TOOLS);

describe("BuildAssistantUseCase — decline path", () => {
  it("returns the decline assistant when frontDesk is off (single greeting, no tools)", async () => {
    const settings = new FakeSettingsReader(settingsFor({ frontDesk: false }));
    const uc = makeUseCase({
      settings,
      leadByPhone: new FakeLeadByPhone(null),
      leadSummary: new FakeLeadSummary(null),
    });
    const r = await uc.exec({ orgId: ORG, fromNumber: "+14155550100" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const dto = r.value;
    expect(dto.firstMessage).toContain("Bayline Plumbing");
    expect(dto.firstMessage).toMatch(/can't take your call|try again during business hours/i);
    expect(dto.model.tools).toEqual([]);
    expect(dto.model.messages).toEqual([]);
    expect(dto.endCallFunctionEnabled).toBe(true);
    expect(dto.artifactPlan.recordingEnabled).toBe(true);
  });
});

describe("BuildAssistantUseCase — settings missing", () => {
  it("returns a not_found error when no settings row exists for the org", async () => {
    const uc = makeUseCase({
      settings: new FakeSettingsReader(null),
      leadByPhone: new FakeLeadByPhone(null),
      leadSummary: new FakeLeadSummary(null),
    });
    const r = await uc.exec({ orgId: ORG, fromNumber: null });
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.kind).toBe("not_found");
  });
});

describe("BuildAssistantUseCase — known caller", () => {
  it("wires leadByPhone → leadSummary and injects name + openWork into the prompt", async () => {
    const leadId = asLeadId("33333333-3333-3333-3333-333333333333");
    const settings = new FakeSettingsReader(settingsFor());
    const leadByPhone = new FakeLeadByPhone({ leadId });
    const leadSummary = new FakeLeadSummary({
      name: "Dana Ruiz",
      openWork: "job #142 scheduled Jul 16 (drain clear)",
    });
    const uc = makeUseCase({ settings, leadByPhone, leadSummary });

    const r = await uc.exec({ orgId: ORG, fromNumber: "(415) 555-0100" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const system = r.value.model.messages[0]?.content ?? "";
    expect(system).toContain("Dana Ruiz");
    expect(system).toContain("job #142 scheduled Jul 16 (drain clear)");

    // Single call to each port — no N+1.
    expect(settings.calls).toBe(1);
    expect(leadByPhone.calls).toBe(1);
    expect(leadSummary.calls).toBe(1);
    // fromNumber normalised to E.164 before lookup.
    expect(leadByPhone.lastArg).toBe("+14155550100");
    expect(leadSummary.lastArg).toBe(leadId);
  });
});

describe("BuildAssistantUseCase — unknown caller variants", () => {
  it("no fromNumber → unknown caller, leadByPhone/leadSummary never called", async () => {
    const settings = new FakeSettingsReader(settingsFor());
    const leadByPhone = new FakeLeadByPhone({ leadId: asLeadId("x") });
    const leadSummary = new FakeLeadSummary({ name: "x", openWork: null });
    const uc = makeUseCase({ settings, leadByPhone, leadSummary });

    const r = await uc.exec({ orgId: ORG, fromNumber: null });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(leadByPhone.calls).toBe(0);
    expect(leadSummary.calls).toBe(0);
    expect(r.value.model.messages[0]?.content ?? "").not.toMatch(/the caller is|known caller/i);
  });

  it("unparseable fromNumber → treated as unknown caller (no throw, no lookup)", async () => {
    const settings = new FakeSettingsReader(settingsFor());
    const leadByPhone = new FakeLeadByPhone({ leadId: asLeadId("x") });
    const leadSummary = new FakeLeadSummary({ name: "x", openWork: null });
    const uc = makeUseCase({ settings, leadByPhone, leadSummary });

    const r = await uc.exec({ orgId: ORG, fromNumber: "unknown" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(leadByPhone.calls).toBe(0);
    expect(leadSummary.calls).toBe(0);
  });

  it("phone parses but no lead hit → unknown caller, leadSummary never called", async () => {
    const settings = new FakeSettingsReader(settingsFor());
    const leadByPhone = new FakeLeadByPhone(null);
    const leadSummary = new FakeLeadSummary({ name: "x", openWork: null });
    const uc = makeUseCase({ settings, leadByPhone, leadSummary });

    const r = await uc.exec({ orgId: ORG, fromNumber: "+14155550100" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(leadByPhone.calls).toBe(1);
    expect(leadSummary.calls).toBe(0);
    expect(r.value.model.messages[0]?.content ?? "").not.toMatch(/the caller is|known caller/i);
  });

  it("lead hit but summary null → unknown caller (defensive)", async () => {
    const leadId = asLeadId("33333333-3333-3333-3333-333333333333");
    const settings = new FakeSettingsReader(settingsFor());
    const leadByPhone = new FakeLeadByPhone({ leadId });
    const leadSummary = new FakeLeadSummary(null);
    const uc = makeUseCase({ settings, leadByPhone, leadSummary });

    const r = await uc.exec({ orgId: ORG, fromNumber: "+14155550100" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(leadSummary.calls).toBe(1);
    expect(r.value.model.messages[0]?.content ?? "").not.toMatch(/the caller is|known caller/i);
  });
});

describe("BuildAssistantUseCase — assembly", () => {
  it("uses VOICE_MODEL / VOICE / MAX_CALL_MINUTES and passes the injected tools through", async () => {
    const tool: VoiceToolSpec = {
      type: "function",
      function: { name: "take_message", description: "leave a message", parameters: {} },
    };
    const settings = new FakeSettingsReader(settingsFor());
    const uc = new BuildAssistantUseCase(
      {
        settings,
        leadByPhone: new FakeLeadByPhone(null),
        leadSummary: new FakeLeadSummary(null),
      },
      [tool],
    );
    const r = await uc.exec({ orgId: ORG, fromNumber: null });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const dto = r.value;
    expect(dto.model.provider).toBe(VOICE_MODEL.provider);
    expect(dto.model.model).toBe(VOICE_MODEL.model);
    expect(dto.model.temperature).toBe(VOICE_MODEL.temperature);
    expect(dto.voice.voiceId).toBe(VOICE.voiceId);
    expect(dto.maxDurationSeconds).toBe(MAX_CALL_MINUTES * 60);
    expect(dto.model.tools).toEqual([tool]);
    expect(dto.firstMessage).toBe(
      "Thanks for calling Bayline Plumbing! This call may be recorded. How can I help you today?",
    );
  });
});
