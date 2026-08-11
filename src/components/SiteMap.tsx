"use client";

import { useMemo, useState } from "react";
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
 * Dependency-free site map: an equirectangular scatter of study sites, one
 * circle per site coloured by how close cumulative enrollment is to the
 * target-to-date. Deliberately not a tile map — 12 fixed points in one region
 * don't need a basemap, and this keeps the page free of external requests.
 */
export function SiteMap({ sites, height = 300 }: { sites: SiteProgress[]; height?: number }) {
  const t = useTranslations();
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (sites.length === 0) return null;
    const lats = sites.map((s) => s.latitude);
    const lons = sites.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    // Correct longitude for latitude so the aspect ratio isn't stretched; at
    // ~11 degrees N one degree of longitude is ~0.98 of one degree of latitude.
    const meanLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos((meanLat * Math.PI) / 180);

    // Pad the bounding box so no marker sits on the edge. Guard against a
    // degenerate span (a single site, or sites sharing a coordinate).
    const spanLat = Math.max(maxLat - minLat, 0.01);
    const spanLon = Math.max((maxLon - minLon) * lonScale, 0.01);
    const pad = 0.15;

    const W = 100;
    const H = 100;
    return {
      points: sites.map((s) => ({
        ...s,
        // y is flipped: SVG grows downward, latitude grows northward.
        cx: pad * W + ((s.longitude - minLon) * lonScale / spanLon) * W * (1 - 2 * pad),
        cy: pad * H + (1 - (s.latitude - minLat) / spanLat) * H * (1 - 2 * pad),
      })),
      W,
      H,
    };
  }, [sites]);

  if (!layout) {
    return <EmptyState title={t("map.noCoordinates")} hint={t("map.noCoordinatesHint")} />;
  }

  const active = layout.points.find((p) => p.mrc === hover);

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${layout.W} ${layout.H}`}
          width="100%"
          height={height}
          role="img"
          aria-label={t("map.title")}
        >
          {layout.points.map((p) => (
            <g key={p.mrc}>
              <circle
                cx={p.cx}
                cy={p.cy}
                r={hover === p.mrc ? 3.4 : 2.6}
                fill={paceColor(p.ratio)}
                fillOpacity={0.85}
                stroke="var(--surface)"
                strokeWidth={0.6}
                style={{ cursor: "pointer", transition: "r 120ms" }}
                onMouseEnter={() => setHover(p.mrc)}
                onMouseLeave={() => setHover(null)}
              />
              <text
                x={p.cx}
                y={p.cy - 4}
                textAnchor="middle"
                fontSize={3}
                fill="var(--text-muted)"
                style={{ pointerEvents: "none" }}
              >
                {p.name}
              </text>
            </g>
          ))}
        </svg>

        {/* Hover readout. Kept outside the SVG so it inherits page typography. */}
        <div className="h-9 mt-1 text-xs">
          {active ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 inline-block">
              <span className="font-medium">{active.name}</span>{" "}
              <span className="muted">
                {active.enrolled} / {Math.round(active.target)} (
                {Math.round(active.ratio * 100)}%)
              </span>
            </div>
          ) : (
            <span className="muted">{t("map.hoverHint")}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1">
        {[
          [ON_TRACK, t("map.onTrack")],
          [NEAR, t("map.near")],
          [BEHIND, t("map.behind")],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: color }}
            />
            <span className="muted">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
