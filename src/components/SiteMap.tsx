"use client";

import dynamic from "next/dynamic";
import type { SiteProgress } from "@/lib/metrics";

// Leaflet touches `window` as soon as it's imported, which breaks server
// rendering — load the real map only in the browser. `ssr: false` is only
// valid in a Client Component (hence this thin wrapper), not in a Server
// Component page/layout.
const SiteMapLeaflet = dynamic(() => import("./SiteMapLeaflet").then((m) => m.SiteMapLeaflet), {
  ssr: false,
  loading: () => <div className="rounded-lg bg-[var(--surface-2)] animate-pulse" style={{ height: 320 }} />,
});

export function SiteMap({
  sites,
  height,
  highlightMrc,
}: {
  sites: SiteProgress[];
  height?: number;
  /** When set, only this site is coloured; the rest are greyed out. */
  highlightMrc?: string | null;
}) {
  return <SiteMapLeaflet sites={sites} height={height} highlightMrc={highlightMrc} />;
}
