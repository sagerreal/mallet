// Geocoder port — turns a free-text US address into a point. Lives in the domain so app/infra can
// depend on the interface, not a provider. A miss returns null and NEVER throws: a geocode failure
// (bad address, provider down, timeout) must let callers degrade gracefully and NEVER block a
// booking — proximity/service-area checks that need a point simply skip when the point is missing.

/** A geographic point in decimal degrees (WGS84). */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Resolves a free-text US address to a {@link GeoPoint}, or null when it can't (never throws). */
export interface Geocoder {
  geocode(address: string): Promise<GeoPoint | null>;
}
