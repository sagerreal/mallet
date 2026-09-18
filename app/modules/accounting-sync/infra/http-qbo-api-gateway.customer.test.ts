/**
 * The customer half of the QuickBooks gateway, exercised through a fake fetch.
 *
 * The escaping tests are the point. QuickBooks' query language is SQL-shaped and takes one string,
 * and the values interpolated into it are CUSTOMER-SUPPLIED — so an unescaped apostrophe is both a
 * correctness bug on an ordinary name (O'Brien Plumbing) and a query-injection seam into somebody's
 * accounting company.
 */
import { describe, it, expect, vi } from "vitest";
import { HttpQboApiGateway } from "./http-qbo-api-gateway";
import type { QboAccess } from "../domain/qbo-api-gateway";

const ACCESS = { accessToken: "tok", realmId: "9130" } as unknown as QboAccess;

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Returns the gateway plus the fetch spy, so a test can read the URL that was actually built. */
const build = (body: unknown) => {
  // Typed as fetch so the mock records (url, init) rather than a zero-arg tuple.
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body));
  return { api: new HttpQboApiGateway("sandbox", fetchImpl as unknown as typeof fetch), fetchImpl };
};

const queryOf = (fetchImpl: ReturnType<typeof vi.fn>): string => {
  const url = String(fetchImpl.mock.calls[0]![0]);
  // searchParams.get already decodes; decoding again would throw on a literal % in the value.
  return new URL(url).searchParams.get("query") ?? "";
};

describe("findCustomerByName", () => {
  it("finds a customer by exact display name", async () => {
    const { api, fetchImpl } = build({
      QueryResponse: { Customer: [{ Id: "42", DisplayName: "Acme Plumbing" }] },
    });
    const r = await api.findCustomerByName(ACCESS, "Acme Plumbing");
    expect(r.ok && r.value).toEqual({ id: "42", displayName: "Acme Plumbing" });
    expect(queryOf(fetchImpl)).toContain("DisplayName = 'Acme Plumbing'");
  });

  it("doubles an apostrophe so an ordinary name does not break the query", async () => {
    const { api, fetchImpl } = build({ QueryResponse: {} });
    await api.findCustomerByName(ACCESS, "O'Brien Plumbing");
    expect(queryOf(fetchImpl)).toContain("DisplayName = 'O''Brien Plumbing'");
  });

  // The injection case: a closing quote followed by more syntax must end up inert inside the
  // literal rather than becoming part of the statement.
  it("neutralises an attempt to close the literal and append syntax", async () => {
    const { api, fetchImpl } = build({ QueryResponse: {} });
    await api.findCustomerByName(ACCESS, "x' or DisplayName like '%");
    const q = queryOf(fetchImpl);
    expect(q).toContain("DisplayName = 'x'' or DisplayName like ''%'");
    // Exactly one WHERE clause survived — nothing was appended to the statement.
    expect(q.match(/where/gi)).toHaveLength(1);
  });

  it("reports no match as an ordinary null, not a failure", async () => {
    const { api } = build({ QueryResponse: {} });
    const r = await api.findCustomerByName(ACCESS, "Nobody");
    expect(r.ok && r.value).toBeNull();
  });

  it("fails rather than guessing when QuickBooks returns a customer it cannot read", async () => {
    const { api } = build({ QueryResponse: { Customer: [{ Id: 42, DisplayName: null }] } });
    const r = await api.findCustomerByName(ACCESS, "Acme");
    expect(r.ok).toBe(false);
  });
});

describe("findCustomerByEmail", () => {
  it("queries the email field, escaped the same way", async () => {
    const { api, fetchImpl } = build({ QueryResponse: {} });
    await api.findCustomerByEmail(ACCESS, "o'brien@example.com");
    expect(queryOf(fetchImpl)).toContain("PrimaryEmailAddr = 'o''brien@example.com'");
  });
});

describe("createCustomer", () => {
  it("sends only the fields that have a value", async () => {
    const { api, fetchImpl } = build({ Customer: { Id: "77", DisplayName: "Acme" } });
    const r = await api.createCustomer(ACCESS, {
      displayName: "Acme",
      email: null,
      phone: null,
      addressLine1: null,
    });
    expect(r.ok && r.value).toEqual({ id: "77", displayName: "Acme" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body).toEqual({ DisplayName: "Acme" });
  });

  it("nests email, phone and the single address line where QuickBooks expects them", async () => {
    const { api, fetchImpl } = build({ Customer: { Id: "78", DisplayName: "Acme" } });
    await api.createCustomer(ACCESS, {
      displayName: "Acme",
      email: "a@b.com",
      phone: "555-0100",
      addressLine1: "12 Mill Lane",
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.PrimaryEmailAddr).toEqual({ Address: "a@b.com" });
    expect(body.PrimaryPhone).toEqual({ FreeFormNumber: "555-0100" });
    expect(body.BillAddr).toEqual({ Line1: "12 Mill Lane" });
  });

  it("fails when QuickBooks answers without an id, rather than inventing one", async () => {
    const { api } = build({ Customer: {} });
    expect((await api.createCustomer(ACCESS, {
      displayName: "Acme",
      email: null,
      phone: null,
      addressLine1: null,
    })).ok).toBe(false);
  });
});
