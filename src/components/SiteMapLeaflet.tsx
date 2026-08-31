"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/ui";
import type { SiteProgress } from "@/lib/metrics";

/** Colour stops for enrollment pace against target. */
const BEHIND = "#d1495b";
const NEAR = "#d99a00";
const ON_TRACK = "#2f9e6f";
/** Sites outside the current facility filter — plotted for context only. */
const MUTED = "#9aa3ad";

function paceColor(ratio: number): string {
  if (ratio >= 0.9) return ON_TRACK;
  if (ratio >= 0.6) return NEAR;
  return BEHIND;
}

/** [[south, west], [north, east]] — the extent of the plotted sites. */
type Bounds = [[number, number], [number, number]];

/**
 * Re-fit the viewport whenever the plotted sites change.
 *
 * MapContainer applies its `bounds` prop once, in a mount-guarded ref
 * callback, and ignores every later change — so switching the country filter
 * would otherwise leave the map framed on the previous country. Burkina and
 * Uganda are ~37 degrees of longitude apart, which means looking at an empty
 * map until you pan halfway across Africa.
 *
 * Keyed on the four coordinates rather than the array, because siteProgress
 * rebuilds its result on every filter change: depending on array identity
 * would yank the map back to the default view each time the date or DOB
 * filter moved, undoing whatever the user had panned or zoomed to.
 */
function FitBounds({ bounds }: { bounds: Bounds }) {
  const map = useMap();
  const [[south, west], [north, east]] = bounds;
  useEffect(() => {
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      // Not animated: this is a filter response, so the new framing should be
      // immediate rather than a slow fly between two countries ~37 degrees
      // apart, and it avoids depending on a CSS transition completing.
      { padding: [30, 30], animate: false },
    );
  }, [map, south, west, north, east]);
  return null;
}

/**
 * Interactive site map on real OpenStreetMap tiles (pan/zoom like any online
 * map), one marker per site coloured by how close cumulative enrollment is to
 * the target-to-date. Loaded only on the client (see SiteMap.tsx) — Leaflet
 * touches `window` at import time and can't run during SSR.
 */
export function SiteMapLeaflet({
  sites,
  height = 320,
  highlightMrc,
}: {
  sites: SiteProgress[];
  height?: number;
  /** When set, only this site is coloured; the rest are greyed out. */
  highlightMrc?: string | null;
}) {
  const t = useTranslations();

  const bounds: Bounds | null = useMemo(() => {
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
          <FitBounds bounds={bounds} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {sites.map((s) => {
            // With a site selected, only its own counts are in view — the other
            // markers stay on the map for geographic context but are greyed
            // out, since their progress isn't being measured here.
            const dimmed = !!highlightMrc && s.mrc !== highlightMrc;
            return (
              <CircleMarker
                key={s.mrc}
                center={[s.latitude, s.longitude]}
                radius={dimmed ? 6 : 8}
                pathOptions={{
                  color: "var(--surface)",
                  weight: 2,
                  fillColor: dimmed ? MUTED : paceColor(s.ratio),
                  fillOpacity: dimmed ? 0.4 : 0.9,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <span className="font-medium">{s.name}</span>
                  {!dimmed && (
                    <>
                      <br />
                      {s.cases} / {Math.round(s.target)} ({Math.round(s.ratio * 100)}%)
                    </>
                  )}
                </Tooltip>
              </CircleMarker>
            );
          })}
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
