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
} from "recharts";

export const PALETTE = {
  primary: "#0e7c86",
  pos: "#d1495b",
  neg: "#2e6f95",
  green: "#6b8f3e",
  purple: "#8a5cb0",
  orange: "#d99a00",
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
  dataKey,
  color,
  domainMax,
  height = 72,
}: {
  data: T[];
  xKey: string;
  dataKey: string;
  color: string;
  domainMax: number;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
        <XAxis dataKey={xKey} hide />
        <YAxis hide domain={[0, domainMax]} />
        <Tooltip {...tooltipStyle()} labelFormatter={(v) => fmtWeek(String(v))} />
        <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
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
}: {
  data: T[];
  xKey: string;
  series: Series[];
  height?: number;
  percent?: boolean;
  dateX?: boolean;
  legend?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
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
            strokeWidth={2}
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
}: {
  data: T[];
  xKey: string;
  series: Series[];
  height?: number;
  stacked?: boolean;
  dateX?: boolean;
  refLines?: { x: number; label: string }[];
  angledX?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: refLines.length > 0 ? 20 : 8, right: 12, left: 0, bottom: angledX ? 28 : 4 }}
      >
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={AXIS}
          interval={angledX ? 0 : "preserveStartEnd"}
          angle={angledX ? -35 : 0}
          textAnchor={angledX ? "end" : "middle"}
          height={angledX ? 60 : 30}
          tickFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined}
        />
        <YAxis tick={AXIS} allowDecimals={false} width={44} />
        <Tooltip {...tooltipStyle()} labelFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
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
