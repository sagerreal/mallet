import { describe, it, expect, vi } from "vitest";
import { CensusGeocoder } from "./census-geocoder";

// Deterministic unit coverage for the Census adapter via an injected fake fetch. The single live
// happy-path test lives in census-geocoder.int.test.ts (needs internet). Every path here proves the
// contract: return null (never throw) on any failure, cache hits/misses, and correct x→lng/y→lat.

// Minimal Response-shaped fake — only the fields the adapter reads.
const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

// A Census "onelineaddress" success payload with one match. x=longitude, y=latitude.
const matchBody = (x: number, y: number) => ({
  result: { addressMatches: [{ coordinates: { x, y } }] },
});

describe("CensusGeocoder", () => {
  it("maps a match to a GeoPoint with x→lng and y→lat (no swap)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(matchBody(-77.0365, 38.8977)));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    const point = await geocoder.geocode("1600 Pennsylvania Ave NW, Washington, DC");

    expect(point).toEqual({ lat: 38.8977, lng: -77.0365 });
    expect(point!.lat).toBeGreaterThan(0); // latitude is the positive one
    expect(point!.lng).toBeLessThan(0); // longitude is the negative one
  });

  it("returns null when there are no address matches", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: { addressMatches: [] } }));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("zzzzzz not a real address 99999")).toBeNull();
  });

  it("returns null on a non-200 response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 503));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("123 Main St")).toBeNull();
  });

  it("returns null when the fetch aborts (timeout)", async () => {
    // Honor the abort signal the adapter passes, so controller.signal.aborted is true → "timeout"
    // reason path. Waits past GEOCODE_TIMEOUT_MS (3s) for the adapter's own timer to fire.
    const fetchFn = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("123 Main St")).toBeNull();
  }, 6000);

  it("returns null on malformed JSON body", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ nope: true }));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("123 Main St")).toBeNull();
  });

  it("returns null when res.json() itself throws", async () => {
    const fetchFn = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        }) as unknown as Response,
    );
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("123 Main St")).toBeNull();
  });

  it("caches a hit — the second lookup for the same address does not refetch", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(matchBody(-77.0365, 38.8977)));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    const first = await geocoder.geocode("1600 Pennsylvania Ave NW");
    const second = await geocoder.geocode("  1600 PENNSYLVANIA AVE NW  "); // trim+lowercase → same key

    expect(first).toEqual(second);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("caches a null miss — a failed lookup is not retried", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ result: { addressMatches: [] } }));
    const geocoder = new CensusGeocoder(fetchFn as unknown as typeof fetch);

    expect(await geocoder.geocode("nowhere")).toBeNull();
    expect(await geocoder.geocode("nowhere")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
