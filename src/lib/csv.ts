/** Serialize an array of flat objects to CSV (header = union of all keys). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(",")];
  for (const row of rows) lines.push(keys.map((k) => escape(row[k])).join(","));
  return lines.join("\n");
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
