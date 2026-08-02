/**
 * e2e/helpers/maps-stub.ts
 *
 * A deterministic, network-free stand-in for the Google Maps JS API, installed
 * via page.addInitScript BEFORE the app bundle runs. use-google-maps.ts checks
 * `typeof google.maps !== "undefined"` at mount and skips script injection
 * when it's already there — so with this stub (plus any non-empty
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY on the dev server) the tracer boots straight
 * to "ready" with no key, no quota, no imagery fetch.
 *
 * The stub actually RENDERS: the map is a dark ground-colored panel with an
 * SVG overlay; Markers/Polylines/Polygons project through real Web Mercator
 * math and draw as SVG nodes, so screenshots show the traced outline and the
 * classed edges exactly where the app put them. Interaction is real DOM:
 *   - clicking the map background fires map "click" listeners with the
 *     unprojected lat/lng (tap-to-trace works);
 *   - clickable polylines/markers render a widened transparent hit line with
 *     `data-stub-hit="polyline"` / `data-stub-hit="marker"` for specs to click.
 * `window.__mapsStub.setView(lat, lng, zoom)` recenters map 0 so specs can
 * move from the continental-US default to a rooftop-scale view.
 *
 * geometry.spherical uses the same haversine/radius the app's pure math does
 * (lib/measure/edge-classes.ts), so the live figures in the bar are honest.
 */

export function mapsStubInit(): void {
  const SVGNS = "http://www.w3.org/2000/svg";
  const EARTH_RADIUS_METERS = 6378137;
  const TILE = 256;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  const distanceMeters = (a: LatLngLiteral, b: LatLngLiteral): number => {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sLat = Math.sin(dLat / 2);
    const sLng = Math.sin(dLng / 2);
    const h = sLat * sLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // Planar shoelace on an equirectangular projection around the first vertex —
  // accurate at rooftop scale, which is all the tracer measures.
  const areaSqMeters = (path: LatLngLiteral[]): number => {
    if (path.length < 3) return 0;
    const first = path[0] as LatLngLiteral;
    const cosLat = Math.cos(toRad(first.lat));
    const pts = path.map((p) => ({
      x: EARTH_RADIUS_METERS * toRad(p.lng - first.lng) * cosLat,
      y: EARTH_RADIUS_METERS * toRad(p.lat - first.lat),
    }));
    let sum = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i] as { x: number; y: number };
      const b = pts[(i + 1) % pts.length] as { x: number; y: number };
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  };

  const mercator = (p: LatLngLiteral, zoom: number): { x: number; y: number } => {
    const scale = TILE * Math.pow(2, zoom);
    const sinY = Math.min(Math.max(Math.sin(toRad(p.lat)), -0.9999), 0.9999);
    return {
      x: ((p.lng + 180) / 360) * scale,
      y: (0.5 - Math.log((1 + sinY) / (1 - sinY)) / (4 * Math.PI)) * scale,
    };
  };

  const unmercator = (x: number, y: number, zoom: number): LatLngLiteral => {
    const scale = TILE * Math.pow(2, zoom);
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - 2 * Math.PI * (y / scale);
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  };

  type Listener = { remove: () => void };

  interface Overlay {
    redraw: () => void;
    root: SVGElement | null;
  }

  class StubMap {
    el: HTMLElement;
    svg: SVGSVGElement;
    center: LatLngLiteral;
    zoom: number;
    overlays: Set<Overlay> = new Set();
    private clickCbs: ((e: { latLng: { lat: () => number; lng: () => number } | null }) => void)[] = [];

    constructor(el: HTMLElement, opts: { center: LatLngLiteral; zoom: number }) {
      // React StrictMode double-mounts the map-creation effect in dev; the app
      // keeps only the second instance. One live stub map per container: the
      // newcomer replaces any earlier one (and its SVG) on the same element.
      el.querySelectorAll(':scope > svg[data-stub="map"]').forEach((old) => old.remove());
      stubState.maps = stubState.maps.filter((m) => m.el !== el);

      this.el = el;
      this.center = { ...opts.center };
      this.zoom = opts.zoom;
      el.style.position = "relative";
      el.style.overflow = "hidden";
      // Ground-colored panel — dark enough that the white/amber overlays read
      // the way they do on real imagery.
      el.style.background = "#3B4234";
      const svg = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
      svg.setAttribute("data-stub", "map");
      svg.style.position = "absolute";
      svg.style.inset = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      el.appendChild(svg);
      this.svg = svg;
      svg.addEventListener("click", (ev) => {
        // Overlay hits stop propagation; anything arriving here is background.
        const rect = svg.getBoundingClientRect();
        const latLng = this.unproject(ev.clientX - rect.left, ev.clientY - rect.top);
        for (const cb of this.clickCbs) {
          cb({ latLng: { lat: () => latLng.lat, lng: () => latLng.lng } });
        }
      });
      stubState.maps.push(this);
    }

    project(p: LatLngLiteral): { x: number; y: number } {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      const c = mercator(this.center, this.zoom);
      const m = mercator(p, this.zoom);
      return { x: m.x - c.x + w / 2, y: m.y - c.y + h / 2 };
    }

    unproject(x: number, y: number): LatLngLiteral {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      const c = mercator(this.center, this.zoom);
      return unmercator(c.x + (x - w / 2), c.y + (y - h / 2), this.zoom);
    }

    setCenter(p: LatLngLiteral): void {
      this.center = { ...p };
      this.redrawAll();
    }

    setZoom(z: number): void {
      this.zoom = z;
      this.redrawAll();
    }

    getCenter(): { lat: () => number; lng: () => number } {
      const { lat, lng } = this.center;
      return { lat: () => lat, lng: () => lng };
    }

    getZoom(): number {
      return this.zoom;
    }

    addListener(event: string, cb: (e: never) => void): Listener {
      if (event !== "click") return { remove: () => undefined };
      const typed = cb as unknown as (e: { latLng: { lat: () => number; lng: () => number } | null }) => void;
      this.clickCbs.push(typed);
      return {
        remove: () => {
          this.clickCbs = this.clickCbs.filter((c) => c !== typed);
        },
      };
    }

    redrawAll(): void {
      this.overlays.forEach((o) => o.redraw());
    }
  }

  const attach = (map: StubMap | null, overlay: Overlay): void => {
    if (map === null) {
      if (overlay.root !== null) overlay.root.remove();
      overlay.root = null;
      return;
    }
    map.overlays.add(overlay);
    overlay.redraw();
  };

  class StubMarker implements Overlay {
    root: SVGElement | null = null;
    private map: StubMap | null;
    private opts: {
      position: LatLngLiteral;
      icon?: { scale?: number; fillColor?: string; strokeColor?: string };
      clickable?: boolean;
    };
    private clickCbs: (() => void)[] = [];

    constructor(opts: StubMarker["opts"] & { map: StubMap | null }) {
      this.opts = opts;
      this.map = opts.map;
      attach(this.map, this);
    }

    setMap(map: StubMap | null): void {
      this.map?.overlays.delete(this);
      this.map = map;
      attach(map, this);
    }

    addListener(event: string, cb: () => void): Listener {
      if (event === "click") this.clickCbs.push(cb);
      return {
        remove: () => {
          this.clickCbs = this.clickCbs.filter((c) => c !== cb);
        },
      };
    }

    redraw(): void {
      if (this.root !== null) this.root.remove();
      if (this.map === null) return;
      const { x, y } = this.map.project(this.opts.position);
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("data-stub", "marker");
      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", String(this.opts.icon?.scale ?? 5));
      dot.setAttribute("fill", this.opts.icon?.fillColor ?? "#FFFFFF");
      g.appendChild(dot);
      if (this.opts.clickable === true) {
        const hit = document.createElementNS(SVGNS, "circle");
        hit.setAttribute("cx", String(x));
        hit.setAttribute("cy", String(y));
        hit.setAttribute("r", "14");
        hit.setAttribute("fill", "transparent");
        hit.setAttribute("data-stub-hit", "marker");
        hit.style.cursor = "pointer";
        hit.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.clickCbs.forEach((cb) => cb());
        });
        g.appendChild(hit);
      }
      this.map.svg.appendChild(g);
      this.root = g;
    }
  }

  class StubPolyline implements Overlay {
    root: SVGElement | null = null;
    private map: StubMap | null;
    private opts: {
      path?: LatLngLiteral[];
      strokeColor?: string;
      strokeWeight?: number;
      strokeOpacity?: number;
      clickable?: boolean;
    };
    private clickCbs: (() => void)[] = [];

    constructor(opts: StubPolyline["opts"] & { map?: StubMap | null }) {
      this.opts = opts;
      this.map = opts.map ?? null;
      attach(this.map, this);
    }

    setMap(map: StubMap | null): void {
      this.map?.overlays.delete(this);
      this.map = map;
      attach(map, this);
    }

    addListener(event: string, cb: () => void): Listener {
      if (event === "click") this.clickCbs.push(cb);
      return {
        remove: () => {
          this.clickCbs = this.clickCbs.filter((c) => c !== cb);
        },
      };
    }

    redraw(): void {
      if (this.root !== null) this.root.remove();
      if (this.map === null) return;
      const map = this.map;
      const pts = (this.opts.path ?? [])
        .map((p) => map.project(p))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("data-stub", "polyline");
      const line = document.createElementNS(SVGNS, "polyline");
      line.setAttribute("points", pts);
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", this.opts.strokeColor ?? "#FFFFFF");
      line.setAttribute("stroke-width", String(this.opts.strokeWeight ?? 2));
      line.setAttribute("stroke-opacity", String(this.opts.strokeOpacity ?? 1));
      g.appendChild(line);
      if (this.opts.clickable === true) {
        const hit = document.createElementNS(SVGNS, "polyline");
        hit.setAttribute("points", pts);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke", "transparent");
        hit.setAttribute("stroke-width", "14");
        hit.setAttribute("data-stub-hit", "polyline");
        hit.style.cursor = "pointer";
        hit.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.clickCbs.forEach((cb) => cb());
        });
        g.appendChild(hit);
      }
      map.svg.appendChild(g);
      this.root = g;
    }
  }

  class StubPolygon implements Overlay {
    root: SVGElement | null = null;
    private map: StubMap | null;
    private opts: {
      paths?: LatLngLiteral[];
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
    };

    constructor(opts: StubPolygon["opts"] & { map?: StubMap | null }) {
      this.opts = opts;
      this.map = opts.map ?? null;
      attach(this.map, this);
    }

    setMap(map: StubMap | null): void {
      this.map?.overlays.delete(this);
      this.map = map;
      attach(map, this);
    }

    redraw(): void {
      if (this.root !== null) this.root.remove();
      if (this.map === null) return;
      const map = this.map;
      const pts = (this.opts.paths ?? [])
        .map((p) => map.project(p))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      const poly = document.createElementNS(SVGNS, "polygon");
      poly.setAttribute("data-stub", "polygon");
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", this.opts.fillColor ?? "#FFFFFF");
      poly.setAttribute("fill-opacity", String(this.opts.fillOpacity ?? 0.25));
      poly.setAttribute("stroke", this.opts.strokeColor ?? "#FFFFFF");
      poly.setAttribute("stroke-opacity", String(this.opts.strokeOpacity ?? 1));
      poly.setAttribute("stroke-width", String(this.opts.strokeWeight ?? 2));
      poly.style.pointerEvents = "none";
      map.svg.appendChild(poly);
      this.root = poly;
    }
  }

  class StubGeocoder {
    geocode(): Promise<{ results: { geometry: { location: { lat: () => number; lng: () => number } } }[] }> {
      // A fixed rooftop-scale location — the "job address" every spec shares.
      return Promise.resolve({
        results: [{ geometry: { location: { lat: () => 35.7712, lng: () => -78.6382 } } }],
      });
    }
  }

  const stubState = { maps: [] as StubMap[] };

  const w = window as unknown as Record<string, unknown>;
  w.__mapsStub = {
    state: stubState,
    setView: (lat: number, lng: number, zoom: number): boolean => {
      const map = stubState.maps[0];
      if (map === undefined) return false;
      map.setCenter({ lat, lng });
      map.setZoom(zoom);
      return true;
    },
  };
  w.google = {
    maps: {
      Map: StubMap,
      Marker: StubMarker,
      Polyline: StubPolyline,
      Polygon: StubPolygon,
      Geocoder: StubGeocoder,
      SymbolPath: { CIRCLE: 0 },
      geometry: {
        spherical: {
          computeArea: (path: LatLngLiteral[]): number => areaSqMeters(path),
          computeLength: (path: LatLngLiteral[]): number => {
            let total = 0;
            for (let i = 0; i + 1 < path.length; i += 1) {
              total += distanceMeters(path[i] as LatLngLiteral, path[i + 1] as LatLngLiteral);
            }
            return total;
          },
        },
      },
    },
  };
}
