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
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export interface Series {
  key: string;
  color: string;
  name?: string;
}

export function MultiLine<T extends object>({
  data,
  xKey,
  series,
  height = 300,
  percent = false,
  dateX = false,
}: {
  data: T[];
  xKey: string;
  series: Series[];
  height?: number;
  percent?: boolean;
  dateX?: boolean;
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
          width={44}
        />
        <Tooltip {...tooltipStyle()} labelFormatter={dateX ? (v) => fmtWeek(String(v)) : undefined} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
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
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: angledX ? 28 : 4 }}>
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
        <YAxis tick={AXIS} width={44} />
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
