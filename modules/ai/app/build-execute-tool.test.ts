import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { asOrgId, asUserId, systemClock, type OrgId } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { AgentTool, ToolContext } from "../domain/tool";
import { buildExecuteTool, TOOL_RESULT_OPEN } from "./build-execute-tool";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-4111-8111-111111111111"),
  orgId: ORG,
  role: "owner",
};

const handled: Array<{ tool: string; input: unknown }> = [];

const readTool = (): AgentTool => ({
  name: "customer_get",
  description: "d",
  inputSchema: {},
  input: z.object({ customerId: z.string() }),
  mutating: false,
  async handle(input) {
    handled.push({ tool: "customer_get", input });
    return { ok: true, summary: "notes: call me back" };
  },
});

const writeTool = (): AgentTool => ({
  name: "invoice_send",
  description: "d",
  inputSchema: {},
  input: z.object({ invoiceId: z.string() }),
  mutating: true,
  enrichArgs: () => ({ idempotencyKey: "minted-fresh-every-time" }),
  async handle(input) {
    handled.push({ tool: "invoice_send", input });
    return { ok: true, summary: "Sent invoice 1042." };
  },
});

/** Stands in for withTenant: hands the tool a context without touching a database. */
const fakeRunner = (fn: (ctx: ToolContext) => Promise<unknown>) =>
  fn({
    tx: {} as never,
    orgId: ORG,
    principal: PRINCIPAL,
    deps: {
      bus: new InMemoryEventBus(),
      clock: systemClock,
      ids: uuidGenerator,
      notificationSender: undefined,
      paymentLinkGateway: null,
    },
  } as ToolContext);

const base = () => ({
  tools: [readTool(), writeTool()],
  principal: PRINCIPAL,
  runInTenant: fakeRunner as never,
});

describe("buildExecuteTool", () => {
  beforeEach(() => {
    handled.length = 0;
  });

  it("refuses a tool that is not in the catalog", async () => {
    const execute = buildExecuteTool(base());
    const out = await execute("definitely_not_a_tool", {}, "t1");
    expect(out).toEqual({ ok: false, error: "unknown tool: definitely_not_a_tool" });
    expect(handled).toHaveLength(0);
  });

  it("applies enrichArgs before handing the input to the tool", async () => {
    const execute = buildExecuteTool(base());
    await execute("invoice_send", { invoiceId: "inv-1" }, "t1");
    expect(handled[0]?.input).toMatchObject({ invoiceId: "inv-1", idempotencyKey: "minted-fresh-every-time" });
  });

  it("leaves results undelimited by default — the interactive surfaces are unchanged", async () => {
    const execute = buildExecuteTool(base());
    const out = await execute("customer_get", { customerId: "c1" }, "t1");
    expect(out).toEqual({ ok: true, summary: "notes: call me back" });
  });

  it("delimits results when asked, so customer-authored text cannot read as an instruction", async () => {
    const execute = buildExecuteTool({ ...base(), delimitResults: true });
    const out = await execute("customer_get", { customerId: "c1" }, "t1");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.summary.startsWith(TOOL_RESULT_OPEN)).toBe(true);
      expect(out.summary).toContain("notes: call me back");
    }
  });

  it("replays a recorded execution instead of running the tool again", async () => {
    const ledger = {
      find: vi.fn(async () => ({ toolUseId: "t1", ok: true, summary: "Sent invoice 1042." })),
      record: vi.fn(async () => {}),
    };
    const execute = buildExecuteTool({ ...base(), ledger });
    const out = await execute("invoice_send", { invoiceId: "inv-1" }, "t1");
    expect(out).toEqual({ ok: true, summary: "Sent invoice 1042." });
    // THE guard: the invoice must not be sent twice.
    expect(handled).toHaveLength(0);
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("records a mutating execution so a replay can find it", async () => {
    const ledger = { find: vi.fn(async () => null), record: vi.fn(async () => {}) };
    const execute = buildExecuteTool({ ...base(), ledger });
    await execute("invoice_send", { invoiceId: "inv-1" }, "t7");
    expect(ledger.record).toHaveBeenCalledWith(
      expect.anything(),
      { toolUseId: "t7", tool: "invoice_send", ok: true, summary: "Sent invoice 1042." },
    );
  });

  it("does not spend a ledger row on a read", async () => {
    const ledger = { find: vi.fn(async () => null), record: vi.fn(async () => {}) };
    const execute = buildExecuteTool({ ...base(), ledger });
    await execute("customer_get", { customerId: "c1" }, "t9");
    expect(ledger.record).not.toHaveBeenCalled();
  });
});
