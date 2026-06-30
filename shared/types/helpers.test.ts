import { describe, it, expect } from "vitest";
import {
  asTechId,
  asCompanyId,
  asEstimateId,
  asJobId,
  asVisitId,
  asInvoiceId,
  asPhone,
} from "./ids";
import { money, zeroMoney, addMoney, subMoney, fromDollars, toDollars, formatUsd } from "./money";
import { systemClock, FixedClock } from "./clock";
import { ok, err, map, unwrapOr } from "./result";
import { notFound, conflict, externalService, unauthorized, validation } from "./errors";

describe("id casters", () => {
  it("pass the value through as a branded type", () => {
    expect(asTechId("t")).toBe("t");
    expect(asCompanyId("c")).toBe("c");
    expect(asEstimateId("e")).toBe("e");
    expect(asJobId("j")).toBe("j");
    expect(asVisitId("v")).toBe("v");
    expect(asInvoiceId("i")).toBe("i");
    expect(asPhone("+15550000000")).toBe("+15550000000");
  });
});

describe("money helpers", () => {
  it("adds and subtracts integer cents", () => {
    expect(addMoney(money(100), money(50))).toBe(150);
    expect(subMoney(money(100), money(50))).toBe(50);
    expect(zeroMoney).toBe(0);
  });

  it("converts dollars and formats", () => {
    expect(fromDollars(1.5)).toBe(150);
    expect(toDollars(money(150))).toBe(1.5);
    expect(formatUsd(money(150))).toBe("$1.50");
  });
});

describe("clock", () => {
  it("systemClock returns a Date", () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  it("FixedClock advances and sets", () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe("2026-06-01T00:00:01.000Z");
    clock.set(new Date("2026-07-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("result helpers", () => {
  it("maps over ok and passes err through", () => {
    expect(map(ok(2), (n: number) => n * 3)).toEqual({ ok: true, value: 6 });
    const e = err("bad");
    expect(map(e, (n: number) => n * 3)).toBe(e);
  });

  it("unwrapOr returns value or fallback", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err("x"), 9)).toBe(9);
  });
});

describe("error constructors", () => {
  it("carry the right kind and fields", () => {
    expect(validation("v", "f")).toMatchObject({ kind: "validation", field: "f" });
    expect(notFound("n").kind).toBe("not_found");
    expect(conflict("c").kind).toBe("conflict");
    expect(externalService("stripe", "down")).toMatchObject({
      kind: "external_service",
      service: "stripe",
      retryable: true,
    });
    expect(unauthorized().kind).toBe("unauthorized");
  });
});
