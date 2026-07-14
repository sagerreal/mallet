import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, type OrgId } from "@mallet/shared/types";
import type { GeoPoint, Geocoder } from "../../frontdesk/domain/geocoder";
import { FakeSettingsRepository } from "./get-settings.test";
import { GetSettingsUseCase } from "./get-settings";
import { UpdateConfigUseCase } from "./update-config";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

// Fake Geocoder: records calls and returns a scripted point (or null for a miss). Import the port
// from its own file (not the frontdesk barrel — house gotcha: barrels pull infra + config).
class FakeGeocoder implements Geocoder {
  calls: string[] = [];
  constructor(private readonly result: GeoPoint | null) {}
  async geocode(address: string): Promise<GeoPoint | null> {
    this.calls.push(address);
    return this.result;
  }
}

describe("UpdateConfigUseCase", () => {
  let repo: FakeSettingsRepository;
  let clock: FixedClock;
  let useCase: UpdateConfigUseCase;

  beforeEach(async () => {
    repo = new FakeSettingsRepository();
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    useCase = new UpdateConfigUseCase(repo, clock);
    // ensure a row exists to patch
    await new GetSettingsUseCase(repo).exec(ORG);
  });

  it("patches markup and persists", async () => {
    const result = await useCase.exec({ markupBps: 4200 }, ORG);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.markupBps).toBe(4200);
    expect(repo.config?.props.markupBps).toBe(4200);
  });

  it("patches the booking blob", async () => {
    const result = await useCase.exec(
      { booking: { services: [], notServices: "x", serviceFee: 120, feeCredited: false } },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.booking.serviceFee).toBe(120);
  });

  it("returns a validation error for negative markup and does not persist it", async () => {
    const result = await useCase.exec({ markupBps: -1 }, ORG);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") expect(result.error.field).toBe("markupBps");
    expect(repo.config?.props.markupBps).toBe(3500);
  });

  describe("geocode-on-save", () => {
    const ADDRESS = "123 Main St, Pleasanton, CA 94566";
    const POINT: GeoPoint = { lat: 37.6624, lng: -121.8747 };

    it("geocodes a newly set address and persists the point", async () => {
      const geocoder = new FakeGeocoder(POINT);
      const uc = new UpdateConfigUseCase(repo, clock, geocoder);
      const result = await uc.exec({ serviceOriginAddress: ADDRESS }, ORG);

      expect(isOk(result)).toBe(true);
      expect(geocoder.calls).toEqual([ADDRESS]);
      expect(repo.config?.props.serviceOriginAddress).toBe(ADDRESS);
      expect(repo.config?.props.originLat).toBe(37.6624);
      expect(repo.config?.props.originLng).toBe(-121.8747);
    });

    it("saves the address with null lat/lng when the geocode misses", async () => {
      const geocoder = new FakeGeocoder(null);
      const uc = new UpdateConfigUseCase(repo, clock, geocoder);
      const result = await uc.exec({ serviceOriginAddress: ADDRESS }, ORG);

      expect(isOk(result)).toBe(true); // a miss NEVER fails the save
      expect(geocoder.calls).toEqual([ADDRESS]);
      expect(repo.config?.props.serviceOriginAddress).toBe(ADDRESS);
      expect(repo.config?.props.originLat).toBeNull();
      expect(repo.config?.props.originLng).toBeNull();
    });

    it("does NOT re-geocode when the address is unchanged", async () => {
      // First save resolves the point.
      const first = new FakeGeocoder(POINT);
      await new UpdateConfigUseCase(repo, clock, first).exec(
        { serviceOriginAddress: ADDRESS },
        ORG,
      );
      // Second save sends the same address alongside another change — must not call the geocoder.
      const second = new FakeGeocoder(POINT);
      const result = await new UpdateConfigUseCase(repo, clock, second).exec(
        { serviceOriginAddress: ADDRESS, markupBps: 4000 },
        ORG,
      );

      expect(isOk(result)).toBe(true);
      expect(second.calls).toEqual([]); // unchanged address → no re-geocode
      expect(repo.config?.props.markupBps).toBe(4000);
      // Point preserved from the first save.
      expect(repo.config?.props.originLat).toBe(37.6624);
      expect(repo.config?.props.originLng).toBe(-121.8747);
    });

    it("does not call the geocoder when the address is absent from the command", async () => {
      const geocoder = new FakeGeocoder(POINT);
      const uc = new UpdateConfigUseCase(repo, clock, geocoder);
      await uc.exec({ markupBps: 4200 }, ORG);
      expect(geocoder.calls).toEqual([]);
    });

    it("clears the point when the address is set to null", async () => {
      // Seed an existing origin.
      await new UpdateConfigUseCase(repo, clock, new FakeGeocoder(POINT)).exec(
        { serviceOriginAddress: ADDRESS },
        ORG,
      );
      const geocoder = new FakeGeocoder(POINT);
      const result = await new UpdateConfigUseCase(repo, clock, geocoder).exec(
        { serviceOriginAddress: null },
        ORG,
      );

      expect(isOk(result)).toBe(true);
      expect(geocoder.calls).toEqual([]); // clearing never geocodes
      expect(repo.config?.props.serviceOriginAddress).toBeNull();
      expect(repo.config?.props.originLat).toBeNull();
      expect(repo.config?.props.originLng).toBeNull();
    });
  });
});
