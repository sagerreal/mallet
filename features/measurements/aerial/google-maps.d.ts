/**
 * features/measurements/aerial/google-maps.d.ts
 * Minimal ambient typings for the slice of the Google Maps JS API the aerial
 * tracer uses. Hand-written instead of @types/google.maps so PR 2 doesn't
 * touch the lockfile while stacked on the backend branch — widen here as the
 * tracer grows, or swap for the full package later.
 */

declare namespace google.maps {
  interface MapsEventListener {
    remove(): void;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface MapMouseEvent {
    latLng: LatLng | null;
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    mapTypeId?: string;
    tilt?: number;
    disableDefaultUI?: boolean;
    zoomControl?: boolean;
    clickableIcons?: boolean;
    gestureHandling?: string;
    draggableCursor?: string;
  }

  class Map {
    constructor(el: HTMLElement, opts?: MapOptions);
    setCenter(center: LatLngLiteral): void;
    getCenter(): LatLng | undefined;
    setZoom(zoom: number): void;
    getZoom(): number | undefined;
    setOptions(opts: MapOptions): void;
    addListener(event: string, cb: (e: MapMouseEvent) => void): MapsEventListener;
  }

  const SymbolPath: { CIRCLE: number };

  interface MarkerSymbol {
    path: number;
    scale: number;
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeWeight: number;
  }

  interface MarkerOptions {
    position: LatLngLiteral;
    map: Map | null;
    icon?: MarkerSymbol;
    clickable?: boolean;
    zIndex?: number;
    title?: string;
    cursor?: string;
  }

  class Marker {
    constructor(opts: MarkerOptions);
    setMap(map: Map | null): void;
    addListener(event: string, cb: () => void): MapsEventListener;
  }

  interface PolylineOptions {
    path?: LatLngLiteral[];
    map?: Map | null;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    clickable?: boolean;
  }

  class Polyline {
    constructor(opts?: PolylineOptions);
    setMap(map: Map | null): void;
  }

  interface PolygonOptions {
    paths?: LatLngLiteral[];
    map?: Map | null;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    fillColor?: string;
    fillOpacity?: number;
    clickable?: boolean;
  }

  class Polygon {
    constructor(opts?: PolygonOptions);
    setMap(map: Map | null): void;
  }

  interface GeocoderResult {
    geometry: { location: LatLng };
  }

  interface GeocoderResponse {
    results: GeocoderResult[];
  }

  class Geocoder {
    geocode(request: { address: string }): Promise<GeocoderResponse>;
  }

  namespace geometry.spherical {
    function computeArea(path: LatLngLiteral[]): number;
    function computeLength(path: LatLngLiteral[]): number;
  }
}
