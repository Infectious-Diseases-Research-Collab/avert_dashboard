"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui";
import type { SiteProgress } from "@/lib/metrics";

/** Colour stops for enrollment pace against target. */
const BEHIND = "#d1495b";
const NEAR = "#d99a00";
const ON_TRACK = "#2f9e6f";

function paceColor(ratio: number): string {
  if (ratio >= 0.9) return ON_TRACK;
  if (ratio >= 0.6) return NEAR;
  return BEHIND;
}

/**
 * Interactive site map on real OpenStreetMap tiles (pan/zoom like any online
 * map), one marker per site coloured by how close cumulative enrollment is to
 * the target-to-date. Loaded only on the client (see SiteMap.tsx) — Leaflet
 * touches `window` at import time and can't run during SSR.
 */
export function SiteMapLeaflet({ sites, height = 320 }: { sites: SiteProgress[]; height?: number }) {
  const t = useTranslations();

  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (sites.length === 0) return null;
    const lats = sites.map((s) => s.latitude);
    const lons = sites.map((s) => s.longitude);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }, [sites]);

  if (!bounds) {
    return <EmptyState title={t("map.noCoordinates")} hint={t("map.noCoordinatesHint")} />;
  }

  return (
    <div>
      <div style={{ height }} className="rounded-lg overflow-hidden">
        <MapContainer bounds={bounds} boundsOptions={{ padding: [30, 30] }} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {sites.map((s) => (
            <CircleMarker
              key={s.mrc}
              center={[s.latitude, s.longitude]}
              radius={8}
              pathOptions={{
                color: "var(--surface)",
                weight: 2,
                fillColor: paceColor(s.ratio),
                fillOpacity: 0.9,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <span className="font-medium">{s.name}</span>
                <br />
                {s.enrolled} / {Math.round(s.target)} ({Math.round(s.ratio * 100)}%)
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-2">
        {[
          [ON_TRACK, t("map.onTrack")],
          [NEAR, t("map.near")],
          [BEHIND, t("map.behind")],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="muted">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
