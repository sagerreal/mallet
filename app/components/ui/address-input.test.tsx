// @vitest-environment jsdom
/**
 * components/ui/address-input.test.tsx
 *
 * The autocomplete's coordinate handoff: picking a suggestion must resolve the
 * place's location via Place Details (the SAME Places API the autocomplete
 * call uses) and pass it to onSelect alongside the address — callers pan maps
 * from it with no Geocoding API call. A failed details lookup passes null so
 * the caller can fall back to its own resolution; it must never throw or drop
 * the selected address.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressInput } from "./address-input";

const ADDRESS = "286 Pine Street, Weymouth, MA, USA";
const PLACE_ID = "ChIJtest123";

function autocompleteResponse() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        suggestions: [
          { placePrediction: { text: { text: ADDRESS }, placeId: PLACE_ID } },
        ],
      }),
  };
}

function detailsResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ location: { latitude: 42.2205, longitude: -70.9403 } }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function typeAndOpenSuggestions() {
  render(
    <AddressInput
      value=""
      onChange={onChange}
      onSelect={onSelect}
      aria-label="Property address"
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "286 Pine" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350); // past the 300ms debounce
  });
  expect(screen.getByRole("option")).toBeTruthy();
}

/** Flush the select's async Place Details resolution. */
async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

let onChange = vi.fn();
let onSelect = vi.fn();

describe("AddressInput — coordinate handoff on select", () => {
  beforeEach(() => {
    onChange = vi.fn();
    onSelect = vi.fn();
  });

  it("resolves the picked place's location via Place Details and hands it to onSelect", async () => {
    fetchMock
      .mockResolvedValueOnce(autocompleteResponse())
      .mockResolvedValueOnce(detailsResponse());
    await typeAndOpenSuggestions();

    fireEvent.mouseDown(screen.getByRole("option"));
    expect(onChange).toHaveBeenLastCalledWith(ADDRESS);

    await flush();
    expect(onSelect).toHaveBeenCalledWith(ADDRESS, { lat: 42.2205, lng: -70.9403 });
    // The details call hits the Places API with the location field mask only.
    const detailsCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(detailsCall[0]).toBe(`https://places.googleapis.com/v1/places/${PLACE_ID}`);
    expect((detailsCall[1].headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("location");
  });

  it("a failed details lookup passes null — the caller falls back to geocoding", async () => {
    fetchMock
      .mockResolvedValueOnce(autocompleteResponse())
      .mockResolvedValueOnce({ ok: false, status: 403 });
    await typeAndOpenSuggestions();

    fireEvent.mouseDown(screen.getByRole("option"));
    await flush();
    expect(onSelect).toHaveBeenCalledWith(ADDRESS, null);
  });

  it("a prediction without a place id selects with null location, no details fetch", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ suggestions: [{ placePrediction: { text: { text: ADDRESS } } }] }),
    });
    await typeAndOpenSuggestions();

    fireEvent.mouseDown(screen.getByRole("option"));
    await flush();
    expect(onSelect).toHaveBeenCalledWith(ADDRESS, null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
