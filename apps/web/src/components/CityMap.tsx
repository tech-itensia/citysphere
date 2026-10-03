import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DOMAINS, SEV_COLOR } from "../lib/format";
import { Icon } from "./Icon";

/**
 * 2D digital twin map (MapLibre GL). Devices are a GPU circle layer coloured by domain (scales to 10k+ assets);
 * incidents are pin markers coloured by severity; "3D" tilts the camera and extrudes buildings (2.5D view).
 * Basemap: CARTO Positron vector tiles (no API key). Set VITE_MAP_STYLE to use your own style.
 */
const STYLE = import.meta.env.VITE_MAP_STYLE ?? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export interface MapDevice { deviceId: string; deviceType?: string; domain?: string; lat?: number; lon?: number; alarms?: string[]; online?: boolean }
export interface MapIncident { id: string; ref?: string; title: string; severity: string; lat?: number; lon?: number; status?: string }

const PIN_SVG: Record<string, string> = {
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z" fill="#fff"/>',
  drop: '<path d="M12 2.7C9 6.5 6 9.6 6 13.5a6 6 0 0 0 12 0c0-3.9-3-7-6-10.8z" fill="#fff"/>',
  alert: '<path d="M12 3 2 21h20zM12 9v5m0 3v.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
};

function pinElement(color: string, glyph: keyof typeof PIN_SVG, pulse: boolean) {
  const el = document.createElement("div");
  el.className = `marker${pulse ? " pulse" : ""}`;
  el.style.background = color;
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24">${PIN_SVG[glyph]}</svg>`;
  return el;
}

export function CityMap({
  center, devices = [], incidents = [], height, tall, onSelectDevice, onSelectIncident, onPick, showLegend = true, title, live = true,
}: {
  center: { lat: number; lon: number };
  devices?: MapDevice[];
  incidents?: MapIncident[];
  height?: number;
  tall?: boolean;
  onSelectDevice?: (id: string) => void;
  onSelectIncident?: (id: string) => void;
  onPick?: (lat: number, lon: number) => void;
  showLegend?: boolean;
  title?: string;
  live?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [loaded, setLoaded] = useState(false);
  const cb = useRef({ onSelectDevice, onSelectIncident, onPick });
  cb.current = { onSelectDevice, onSelectIncident, onPick };

  // create map once
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current, style: STYLE, center: [center.lon, center.lat], zoom: 11.3, pitch: 50, bearing: -15, attributionControl: { compact: true },
    });
    map.current = m;
    m.on("load", () => {
      // 2.5D buildings from the basemap's vector tiles (OpenMapTiles schema)
      const src = Object.keys(m.getStyle().sources ?? {})[0];
      if (src) {
        try {
          m.addLayer({
            id: "scaas-buildings", type: "fill-extrusion", source: src, "source-layer": "building", minzoom: 12,
            paint: {
              "fill-extrusion-color": "#dfe6f2",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.85,
            },
          });
        } catch { /* style without building layer */ }
      }
      m.addSource("scaas-devices", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "scaas-devices", type: "circle", source: "scaas-devices",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["get", "alarm"], "#ef4444", "#ffffff"],
          "circle-stroke-width": ["case", ["get", "alarm"], 3, 1.5],
          "circle-opacity": ["case", ["get", "online"], 0.95, 0.4],
        },
      });
      m.on("click", "scaas-devices", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) cb.current.onSelectDevice?.(String(id));
      });
      m.on("mouseenter", "scaas-devices", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "scaas-devices", () => { m.getCanvas().style.cursor = ""; });
      m.on("click", (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ["scaas-devices"] });
        if (!hit.length) cb.current.onPick?.(e.lngLat.lat, e.lngLat.lng);
      });
      setLoaded(true);
    });
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recenter when the tenant changes
  useEffect(() => { map.current?.flyTo({ center: [center.lon, center.lat], duration: 800 }); }, [center.lat, center.lon]);

  // device layer
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const src = m.getSource("scaas-devices") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: devices.filter((d) => d.lat !== undefined && d.lon !== undefined).map((d) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lon as number, d.lat as number] },
        properties: { id: d.deviceId, color: (DOMAINS[d.domain ?? "generic"] ?? DOMAINS.generic).color, alarm: (d.alarms?.length ?? 0) > 0, online: d.online !== false },
      })),
    });
  }, [devices, loaded]);

  // incident pins
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = incidents.filter((i) => i.lat !== undefined && i.lon !== undefined).slice(0, 200).map((i) => {
      const el = pinElement(SEV_COLOR[i.severity] ?? "#3b82f6", "alert", i.severity === "Critical" && i.status === "New");
      el.title = `${i.ref ?? ""} ${i.title}`;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); cb.current.onSelectIncident?.(i.id); });
      return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([i.lon as number, i.lat as number]).addTo(m);
    });
  }, [incidents, loaded]);

  // 2D / 3D
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    m.easeTo({ pitch: mode === "3d" ? 50 : 0, bearing: mode === "3d" ? -15 : 0, duration: 600 });
    if (m.getLayer("scaas-buildings")) m.setLayoutProperty("scaas-buildings", "visibility", mode === "3d" ? "visible" : "none");
  }, [mode, loaded]);

  return (
    <div>
      {(title || live) && (
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            {title && <h3 style={{ margin: 0 }}>{title}</h3>}
            {live && <span className="live" style={{ marginTop: 6 }}><i /> Live</span>}
          </div>
          <div className="row">
            <div className="seg">
              <button className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")}>3D</button>
              <button className={mode === "2d" ? "on" : ""} onClick={() => setMode("2d")}>2D</button>
            </div>
            <button className="btn sm" aria-label="Full screen" onClick={() => box.current?.requestFullscreen?.()}><Icon name="Maximize2" size={15} /></button>
          </div>
        </div>
      )}
      <div className={`map-wrap${tall ? " tall" : ""}`} style={height ? { height } : undefined}>
        <div ref={box} style={{ position: "absolute", inset: 0 }} />
      </div>
      {showLegend && (
        <div className="legend mt" style={{ marginTop: 10 }}>
          {Object.entries(DOMAINS).filter(([k]) => k !== "generic").map(([k, d]) => (
            <span key={k}><i style={{ background: d.color }} />{d.label}</span>
          ))}
          <span><i style={{ background: "#fff", border: "3px solid #ef4444" }} />Device in alarm</span>
        </div>
      )}
    </div>
  );
}
