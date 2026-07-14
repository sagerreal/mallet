import { describe, it, expect } from "vitest";
// Import the file DIRECTLY (never the modules/frontdesk barrel — it pulls the config
// validator which throws without DB env; house gotcha).
import {
  parseServerMessage,
  extractOrgNumber,
  extractCallerNumber,
  type ParsedServerMessage,
} from "./vapi-schemas";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Every fixture carries an EXTRA unknown top-level + nested field to prove passthrough:
// Vapi adds fields freely and we must never reject on them.

const assistantRequestBody = {
  message: {
    type: "assistant-request",
    unknownTopLevel: "vapi-added",
    phoneNumber: { number: "+16693413343", extra: "ignored" },
    call: {
      id: "call_abc",
      customer: { number: "+14155550123", sipUri: "sip:ignored" },
      phoneNumber: { number: "+19999999999" }, // nested fallback — top-level wins
    },
  },
};

const toolCallsBodyObjectArgs = {
  message: {
    type: "tool-calls",
    call: { id: "call_tools" },
    toolCallList: [
      {
        id: "tc_1",
        name: "take_message",
        arguments: { caller_name: "Pat", topic: "callback" },
        extraField: "ignored",
      },
    ],
  },
};

const toolCallsBodyStringArgs = {
  message: {
    type: "tool-calls",
    call: { id: "call_tools_str" },
    toolCallList: [
      {
        id: "tc_2",
        name: "book_visit",
        arguments: '{"service_name":"Drain","slot_window":"morning"}',
      },
    ],
  },
};

const toolCallsBodyMalformedStringArgs = {
  message: {
    type: "tool-calls",
    call: { id: "call_tools_bad" },
    toolCallList: [{ id: "tc_3", name: "book_visit", arguments: "not-json{" }],
  },
};

const endOfCallBody = {
  message: {
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    startedAt: "2026-07-14T10:00:00.000Z",
    endedAt: "2026-07-14T10:03:00.000Z",
    call: { id: "call_end", unknownField: 1 },
    artifact: {
      transcript: "AI: Hi. Caller: Hello.",
      messages: [
        { role: "system", message: "You are...", extraMsgField: true },
        { role: "user", message: "Hi" },
        { role: "assistant" }, // message omitted — tolerate
      ],
      recording: { stereoUrl: "https://rec/stereo.wav", url: "https://rec/mono.wav" },
    },
  },
};

const statusUpdateBody = {
  message: { type: "status-update", status: "ended", call: { id: "call_status" }, extra: 1 },
};

// ── parseServerMessage: envelope + failure handling ──────────────────────────

describe("parseServerMessage — envelope", () => {
  it("returns a typed failure (no throw) on null", () => {
    const r = parseServerMessage(null);
    expect(r.ok).toBe(false);
  });

  it("returns a typed failure on missing envelope", () => {
    const r = parseServerMessage({ notMessage: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe("string");
  });

  it("returns a typed failure when message.type is absent", () => {
    const r = parseServerMessage({ message: { call: { id: "x" } } });
    expect(r.ok).toBe(false);
  });

  it("does not throw on arbitrary junk", () => {
    expect(() => parseServerMessage("junk")).not.toThrow();
    expect(() => parseServerMessage(42)).not.toThrow();
    expect(() => parseServerMessage([])).not.toThrow();
    expect(parseServerMessage("junk").ok).toBe(false);
  });

  it("yields { type: 'unknown', rawType } for unrecognized types (NOT a failure)", () => {
    const r = parseServerMessage({ message: { type: "speech-update", foo: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("unknown");
      if (r.value.type === "unknown") expect(r.value.rawType).toBe("speech-update");
    }
  });
});

// ── assistant-request ─────────────────────────────────────────────────────────

describe("parseServerMessage — assistant-request", () => {
  it("parses with extra unknown fields (passthrough) and extracts numbers", () => {
    const r = parseServerMessage(assistantRequestBody);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "assistant-request") {
      expect(r.value.callId).toBe("call_abc");
      expect(r.value.callerNumber).toBe("+14155550123");
      expect(r.value.orgNumber).toBe("+16693413343"); // top-level preferred
    } else {
      throw new Error("expected assistant-request");
    }
  });

  it("tolerates an ABSENT call object — org still resolved, callId null (A2-review carry)", () => {
    // Vapi can POST assistant-request before the call object is populated. We must still answer.
    const body = {
      message: {
        type: "assistant-request",
        phoneNumber: { number: "+16693413343" },
      },
    };
    const r = parseServerMessage(body);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "assistant-request") {
      expect(r.value.callId).toBeNull();
      expect(r.value.callerNumber).toBeNull();
      expect(r.value.orgNumber).toBe("+16693413343");
    } else {
      throw new Error("expected assistant-request");
    }
  });

  // Regression: the exact production payload that 400'd every message type. Vapi sends the
  // nested per-call copies (call.phoneNumber, call.customer) as an explicit `null` (or a bare
  // string) while the real org number lives on the TOP-LEVEL phoneNumber object. The old strict
  // `z.object({number}).optional()` leaf rejected null → "invalid ... payload: call.phoneNumber".
  it("tolerates a NULL call.phoneNumber / call.customer and resolves org from the top level", () => {
    const body = {
      message: {
        type: "assistant-request",
        phoneNumber: { number: "+16693413343", extra: "ok" },
        call: { id: "call_null", customer: null, phoneNumber: null },
      },
    };
    const r = parseServerMessage(body);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "assistant-request") {
      expect(r.value.callId).toBe("call_null");
      expect(r.value.callerNumber).toBeNull();
      expect(r.value.orgNumber).toBe("+16693413343");
    } else {
      throw new Error("expected assistant-request");
    }
  });

  it("tolerates a bare-STRING call.phoneNumber (another shape Vapi sends)", () => {
    const body = {
      message: {
        type: "assistant-request",
        phoneNumber: { number: "+16693413343" },
        call: { id: "call_str", customer: "+14155550123", phoneNumber: "+16693413343" },
      },
    };
    const r = parseServerMessage(body);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "assistant-request") {
      expect(r.value.callId).toBe("call_str");
      // A bare string isn't an object carrying `.number`, so caller falls back to null — but the
      // call still parses (no 400) and the org resolves from the top-level echo.
      expect(r.value.callerNumber).toBeNull();
      expect(r.value.orgNumber).toBe("+16693413343");
    } else {
      throw new Error("expected assistant-request");
    }
  });
});

// ── tool-calls ────────────────────────────────────────────────────────────────

describe("parseServerMessage — tool-calls", () => {
  it("parses object arguments unchanged (passthrough on extra tool fields)", () => {
    const r = parseServerMessage(toolCallsBodyObjectArgs);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "tool-calls") {
      expect(r.value.callId).toBe("call_tools");
      expect(r.value.toolCalls).toHaveLength(1);
      const tc = r.value.toolCalls[0];
      if (!tc) throw new Error("expected a tool call");
      expect(tc.id).toBe("tc_1");
      expect(tc.name).toBe("take_message");
      expect(tc.arguments).toEqual({ caller_name: "Pat", topic: "callback" });
    } else {
      throw new Error("expected tool-calls");
    }
  });

  it("normalizes JSON-string arguments to an object", () => {
    const r = parseServerMessage(toolCallsBodyStringArgs);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "tool-calls") {
      expect(r.value.toolCalls[0]?.arguments).toEqual({
        service_name: "Drain",
        slot_window: "morning",
      });
    } else {
      throw new Error("expected tool-calls");
    }
  });

  it("leaves malformed JSON-string arguments as-is (downstream tool runner rejects cleanly)", () => {
    const r = parseServerMessage(toolCallsBodyMalformedStringArgs);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "tool-calls") {
      expect(r.value.toolCalls[0]?.arguments).toBe("not-json{");
    } else {
      throw new Error("expected tool-calls");
    }
  });

  // Regression: the REAL Vapi shape (OpenAI tool-call) nests name+arguments under `function`,
  // with arguments as a JSON string. The old flat schema 400'd every tool call
  // ("invalid tool-calls payload: toolCallList.0.name, toolCallList.0.arguments"), breaking
  // scheduling and take_message on live calls.
  it("reads name+arguments NESTED under function (Vapi/OpenAI shape) with string arguments", () => {
    const body = {
      message: {
        type: "tool-calls",
        call: { id: "call_fn", phoneNumber: null, customer: null },
        toolCallList: [
          {
            id: "tc_fn",
            type: "function",
            function: {
              name: "book_visit",
              arguments: '{"service_name":"Recurring office cleaning","slot_window":"morning"}',
            },
          },
        ],
      },
    };
    const r = parseServerMessage(body);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "tool-calls") {
      expect(r.value.callId).toBe("call_fn");
      expect(r.value.toolCalls[0]?.id).toBe("tc_fn");
      expect(r.value.toolCalls[0]?.name).toBe("book_visit");
      expect(r.value.toolCalls[0]?.arguments).toEqual({
        service_name: "Recurring office cleaning",
        slot_window: "morning",
      });
    } else {
      throw new Error("expected tool-calls");
    }
  });
});

// ── end-of-call-report ──────────────────────────────────────────────────────

describe("parseServerMessage — end-of-call-report", () => {
  it("parses transcript, messages, timestamps with extra fields", () => {
    const r = parseServerMessage(endOfCallBody);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "end-of-call-report") {
      expect(r.value.callId).toBe("call_end");
      expect(r.value.endedReason).toBe("customer-ended-call");
      expect(r.value.transcript).toBe("AI: Hi. Caller: Hello.");
      expect(r.value.startedAt).toBe("2026-07-14T10:00:00.000Z");
      expect(r.value.endedAt).toBe("2026-07-14T10:03:00.000Z");
      expect(r.value.messages).toHaveLength(3);
      expect(r.value.messages?.[2]).toMatchObject({ role: "assistant" });
    } else {
      throw new Error("expected end-of-call-report");
    }
  });

  it("prefers recording.stereoUrl in the fallback chain", () => {
    const r = parseServerMessage(endOfCallBody);
    if (r.ok && r.value.type === "end-of-call-report") {
      expect(r.value.recordingUrl).toBe("https://rec/stereo.wav");
    } else {
      throw new Error("expected end-of-call-report");
    }
  });

  it("falls back to recording.url when stereoUrl is absent", () => {
    const body = {
      message: {
        type: "end-of-call-report",
        call: { id: "c" },
        artifact: { recording: { url: "https://rec/mono.wav" } },
      },
    };
    const r = parseServerMessage(body);
    if (r.ok && r.value.type === "end-of-call-report") {
      expect(r.value.recordingUrl).toBe("https://rec/mono.wav");
    } else {
      throw new Error("expected end-of-call-report");
    }
  });

  it("falls back to artifact.recordingUrl last", () => {
    const body = {
      message: {
        type: "end-of-call-report",
        call: { id: "c" },
        artifact: { recordingUrl: "https://rec/legacy.wav" },
      },
    };
    const r = parseServerMessage(body);
    if (r.ok && r.value.type === "end-of-call-report") {
      expect(r.value.recordingUrl).toBe("https://rec/legacy.wav");
    } else {
      throw new Error("expected end-of-call-report");
    }
  });

  it("recordingUrl is null when no recording present", () => {
    const body = { message: { type: "end-of-call-report", call: { id: "c" }, artifact: {} } };
    const r = parseServerMessage(body);
    if (r.ok && r.value.type === "end-of-call-report") {
      expect(r.value.recordingUrl).toBeNull();
    } else {
      throw new Error("expected end-of-call-report");
    }
  });
});

// ── status-update ─────────────────────────────────────────────────────────────

describe("parseServerMessage — status-update", () => {
  it("parses status + call id with extra fields", () => {
    const r = parseServerMessage(statusUpdateBody);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "status-update") {
      expect(r.value.status).toBe("ended");
      expect(r.value.callId).toBe("call_status");
    } else {
      throw new Error("expected status-update");
    }
  });
});

// ── phone extraction helpers (pure) ─────────────────────────────────────────

describe("extractOrgNumber", () => {
  it("prefers the top-level message.phoneNumber.number", () => {
    expect(
      extractOrgNumber({
        phoneNumber: { number: "+1top" },
        call: { phoneNumber: { number: "+1nested" } },
      }),
    ).toBe("+1top");
  });

  it("falls back to message.call.phoneNumber.number", () => {
    expect(extractOrgNumber({ call: { phoneNumber: { number: "+1nested" } } })).toBe("+1nested");
  });

  it("returns null when neither location has a number", () => {
    expect(extractOrgNumber({ call: {} })).toBeNull();
    expect(extractOrgNumber({})).toBeNull();
  });
});

describe("extractCallerNumber", () => {
  it("reads message.call.customer.number", () => {
    expect(extractCallerNumber({ call: { customer: { number: "+1caller" } } })).toBe("+1caller");
  });

  it("returns null when absent", () => {
    expect(extractCallerNumber({ call: {} })).toBeNull();
    expect(extractCallerNumber({})).toBeNull();
  });
});

// Type-level: ParsedServerMessage is a discriminated union usable in a switch.
describe("ParsedServerMessage discriminant", () => {
  it("narrows by type", () => {
    const parsed: ParsedServerMessage = { type: "unknown", rawType: "x" };
    expect(parsed.type).toBe("unknown");
  });
});
