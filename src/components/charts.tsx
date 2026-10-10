"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  useXAxisScale,
  usePlotArea,
} from "recharts";
import type { DateBand } from "@/lib/metrics";

// Series colors, checked with a perceptual-distance validator rather than by
// eye. The pairs that share a chart have to survive both normal vision and the
// common colour-vision deficiencies, so the hues are deliberately spread:
// `neg` is violet rather than blue because a blue "Controls" line sat only
// ΔE 5.4 from the teal "Enrolled" line (the readable floor is 15) and the two
// were genuinely hard to tell apart; `green` moved off olive, which collapsed
// to ΔE 2.4 against `pos` for red-blind readers.
export const PALETTE = {
  primary: "#0e7c86",
  pos: "#e34948",
  neg: "#4a3aa7",
  green: "#008300",
  purple: "#c0399f",
  orange: "#d99a00",
  brown: "#7a5230",
  grey: "#95a5a6",
  ug: "#1f7a8c",
  bf: "#b5651d",
};

// Distinct-ish color cycle for charts with many series (e.g. up to ~21
// facilities). Colors repeat past the length of the ring — unavoidable with
// that many lines — but adjacent sites stay visually separable.
const COLOR_RING = [
  "#0e7c86", "#d1495b", "#6b8f3e", "#8a5cb0", "#d99a00", "#2e6f95",
  "#b5651d", "#1f7a8c", "#c0399f", "#4c9a2a", "#e07a5f", "#3d5a80",
];

export function cycleColor(i: number): string {
  return COLOR_RING[i % COLOR_RING.length];
}

const AXIS = { fontSize: 12, fill: "var(--text-muted)" };
const GRID = "var(--border)";

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      color: "var(--text)",
      fontSize: 12,
    },
    labelStyle: { color: "var(--text-muted)" },
  } as const;
}

export function fmtWeek(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" });
}

export interface Series {
  key: string;
  color: string;
  name?: string;
  /** Draw as a dashed line — used for target/reference series so they read as
   * a goal rather than as observed data. Only honoured by line charts. */
  dashed?: boolean;
}

/** Max numeric value of `keys` across `rows` — used as a shared y-axis domain
 * so a grid of small-multiple charts stays visually comparable. Falls back to
 * 1 rather than 0 so an all-zero/empty series doesn't collapse the domain. */
export function seriesMax(rows: Record<string, unknown>[], keys: string[]): number {
  let max = 0;
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "number" && v > max) max = v;
    }
  }
  return max || 1;
}

const BAND_COLOR = PALETTE.orange;
const MS_DAY = 86_400_000;
const dayMs = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);

/**
 * Shades date periods (e.g. SMC rounds) behind a chart whose x-axis is a
 * category of bucket keys ("YYYY-MM-DD" day or week starts). The axis has no
 * notion of time, so each date is placed by its fraction through its bucket:
 * bucket i occupies [i - 0.5, i + 0.5], so a 4-day round covers four whole
 * bars in daily view and ~4/7 of a step in weekly view. Gaps between sparse
 * buckets are interpolated using the real day spacing.
 */
function DateBands({ keys, bands, labels }: { keys: string[]; bands: DateBand[]; labels: boolean }) {
  const scale = useXAxisScale();
  const plot = usePlotArea();
  if (!scale || !plot || keys.length === 0) return null;

  const days = keys.map(dayMs);
  const centers = keys.map((k) => scale(k, { position: "middle" }));
  if (centers.some((c) => c === undefined)) return null;
  const px = centers as number[];
  const gaps = days.slice(1).map((d, i) => (d - days[i]) / MS_DAY);
  const bucketDays = gaps.length ? Math.min(...gaps) : 1;
  const step = px.length > 1 ? px[1] - px[0] : plot.width;

  // Fractional axis position of the start of day `t`.
  const pos = (t: number): number => {
    let i = 0;
    while (i + 1 < days.length && days[i + 1] <= t) i++;
    const span = i + 1 < days.length ? (days[i + 1] - days[i]) / MS_DAY : bucketDays;
    return i - 0.5 + (t - days[i]) / MS_DAY / span;
  };
  // Pixel x of a fractional position, extrapolating past either end.
  const toPx = (p: number): number => {
    if (p <= 0) return px[0] + p * step;
    if (p >= px.length - 1) return px[px.length - 1] + (p - (px.length - 1)) * step;
    const i = Math.floor(p);
    return px[i] + (p - i) * (px[i + 1] - px[i]);
  };

  const left = plot.x;
  const right = plot.x + plot.width;
  return (
    <g pointerEvents="none">
      {bands.map((b) => {
        const x1 = Math.max(left, toPx(pos(dayMs(b.start))));
        const x2 = Math.min(right, toPx(pos(dayMs(b.end) + MS_DAY)));
        if (x2 - x1 < 0.5) return null;
        return (
          <g key={b.label}>
            <rect x={x1} y={plot.y} width={x2 - x1} height={plot.height} fill={BAND_COLOR} fillOpacity={0.16} />
            {labels && (
              <text x={(x1 + x2) / 2} y={plot.y + 11} textAnchor="middle" fontSize={10} fontWeight={600} fill={BAND_COLOR}>
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Legend entry for shaded date bands, styled to match ChartLegend. */
export function BandLegend({ label }: { label: string }) {
  return (
    <div className="flex justify-center mt-2 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-2.5 rounded-sm shrink-0" style={{ background: BAND_COLOR, opacity: 0.35 }} />
        <span className="muted">{label}</span>
      </span>
    </div>
  );
}

function bandKeys<T extends object>(data: T[], xKey: string): string[] {
  return data.map((r) => String((r as Record<string, unknown>)[xKey]));
}

/** A single legend shared across several charts, wrapping to fill the width. */
export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-3 text-xs">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
          <span className="muted">{s.name ?? s.key}</span>
        </span>
      ))}
    </div>
  );
}

/** One compact bar sparkline for a small-multiples grid — no visible axes (a
 * grid of a dozen-plus cells has no room for them), but a Tooltip keeps exact
 * values available on hover. `domainMax` should be shared across the grid's
 * cells so bar heights stay comparable from one site to the next. */
export function MiniBar<T extends object>({
  data,
  xKey,
  series,
  domainMax,
  stacked = false,
  height = 72,
  bands = [],
}: {
  data: T[];
  xKey: string;
  series: Series[];
  domainMax: number;
  /** Stack the series into one bar per bucket. The FIRST series sits on the
   * axis — put the scarce/important one there, since segments anchored to the
   * baseline are far easier to compare than floating ones. */
  stacked?: boolean;
  height?: number;
  /** Date periods to shade (unlabelled at this size). */
  bands?: DateBand[];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
        <XAxis dataKey={xKey} hide />
        <YAxis hide domain={[0, domainMax]} />
        {bands.length > 0 && <DateBands keys={bandKeys(data, xKey)} bands={bands} labels={false} />}
        <Tooltip {...tooltipStyle()} labelFormatter={(v) => fmtWeek(String(v))} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name ?? s.key}
            fill={s.color}
            stackId={stacked ? "a" : undefined}
            // Only the topmost segment gets rounded corners.
            radius={stacked && i < series.length - 1 ? 0 : [2, 2, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Line counterpart to MiniBar for small-multiples grids — same hidden axes,
 * shared `domainMax` and hover tooltip. Used for cumulative and positivity
 * per-site cells, where a running line reads better than bars. */
export function MiniLine<T extends object>({
  data,
  xKey,
  series,
  domainMax,
  percent = false,
  height = 72,
  bands = [],
}: {
  data: T[];
  xKey: string;
  series: Series[];
  domainMax: number;
  percent?: boolean;
  height?: number;
  /** Date periods to shade (unlabelled at this size). */
  bands?: DateBand[];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
        <XAxis dataKey={xKey} hide />
        <YAxis hide domain={[0, percent ? 100 : domainMax]} />
        {bands.length > 0 && <DateBands keys={bandKeys(data, xKey)} bands={bands} labels={false} />}
        <Tooltip {...tooltipStyle()} labelFormatter={(v) => fmtWeek(String(v))} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.name ?? s.key}
            stroke={s.color}
            strokeWidth={s.dashed ? 1.25 : 1.75}
            strokeDasharray={s.dashed ? "5 3" : undefined}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MultiLine<T extends object>({
  data,
  xKey,
  series,
  height = 300,
  percent = false,
  dateX = false,
  legend = true,
  bands = [],
}: {
  data: T[];
  xKey: string;
  series: Series[];
  height?: number;
  percent?: boolean;
  dateX?: boolean;
  legend?: boolean;
  /** Labelled date periods to shade behind the lines. */
  bands?: DateBand[];
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        {bands.length > 0 && <DateBands keys={bandKeys(data, xKey)} bands={bands} labels />}
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          tickFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined}
          minTickGap={20}
        />
        <YAxis
          tick={AXIS}
          domain={percent ? [0, 100] : undefined}
          tickFormatter={percent ? (v) => `${v}%` : undefined}
          allowDecimals={!percent}
          width={44}
        />
        <Tooltip {...tooltipStyle()} labelFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined} />
        {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.name ?? s.key}
            stroke={s.color}
            strokeWidth={s.dashed ? 1.5 : 2}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MultiBar<T extends object>({
  data,
  xKey,
  series,
  height = 300,
  stacked = false,
  dateX = false,
  refLines = [],
  angledX = false,
  percent = false,
  legend,
  bands = [],
}: {
  data: T[];
  xKey: string;
  series: Series[];
  height?: number;
  stacked?: boolean;
  dateX?: boolean;
  refLines?: { x: number; label: string }[];
  angledX?: boolean;
  /** Render the y-axis as a fixed 0-100% scale. */
  percent?: boolean;
  /** Defaults to showing recharts' own legend whenever there's more than one
   * series. Pass false to suppress it (e.g. when a single ChartLegend is
   * shared across several small panels instead). */
  legend?: boolean;
  /** Labelled date periods to shade behind the bars. */
  bands?: DateBand[];
}) {
  const showLegend = legend ?? series.length > 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: refLines.length > 0 ? 20 : 8, right: 12, left: 0, bottom: angledX ? 28 : 4 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        {bands.length > 0 && <DateBands keys={bandKeys(data, xKey)} bands={bands} labels />}
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          interval={angledX ? 0 : "preserveStartEnd"}
          angle={angledX ? -35 : 0}
          textAnchor={angledX ? "end" : "middle"}
          height={angledX ? 60 : 30}
          tickFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined}
        />
        <YAxis
          tick={AXIS}
          domain={percent ? [0, 100] : undefined}
          tickFormatter={percent ? (v) => `${v}%` : undefined}
          allowDecimals={false}
          width={44}
        />
        <Tooltip {...tooltipStyle()} labelFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {refLines.map((r) => (
          <ReferenceLine
            key={r.label}
            x={r.x}
            stroke="var(--text-muted)"
            strokeDasharray="4 4"
            label={{ value: r.label, fontSize: 10, fill: "var(--text-muted)", position: "top" }}
          />
        ))}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name ?? s.key}
            fill={s.color}
            stackId={stacked ? "a" : undefined}
            radius={stacked ? 0 : [3, 3, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
