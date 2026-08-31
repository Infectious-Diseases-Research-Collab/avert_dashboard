import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { fetchAllRows } from "@/lib/supabase/paginate";

/**
 * Generate the full, unblinded dataset (enrollee + vaccination_status +
 * blood_smear, every column, nothing stripped) and hand back time-limited
 * signed links to it. Admin-only, and deliberately does NOT use the
 * service-role key — see the comment above the storage policies in
 * schema.sql for why. The route runs as the requesting admin's own
 * authenticated session, so RLS scopes the export to the countries that
 * admin can see, same as every other query in the app.
 */

const BUCKET = "exports";
const TABLES = ["enrollee", "vaccination_status", "blood_smear"] as const;
type TableName = (typeof TABLES)[number];

const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 168; // one week — a generous ceiling, not an endorsement

/** Every column, typed and raw, flattened into one record. Typed/computed
 * columns (e.g. `sex`, a recode) win over any same-named raw field, since
 * they're the authoritative value. */
function flatten(row: Record<string, unknown>): Record<string, unknown> {
  const { raw, ...typed } = row;
  return { ...((raw as Record<string, unknown>) ?? {}), ...typed };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profileRows } = await supabase.rpc("get_my_profile");
  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
  if (!profile?.is_admin) return new Response("Forbidden", { status: 403 });

  let expiresHours = 48;
  try {
    const body = await request.json();
    if (typeof body?.expiresHours === "number") expiresHours = body.expiresHours;
  } catch {
    // no body / not JSON — use the default
  }
  expiresHours = Math.min(MAX_EXPIRY_HOURS, Math.max(MIN_EXPIRY_HOURS, Math.round(expiresHours)));

  const rowsByTable: Record<TableName, Record<string, unknown>[]> = {
    enrollee: [],
    vaccination_status: [],
    blood_smear: [],
  };
  try {
    await Promise.all(
      TABLES.map(async (table) => {
        // PostgREST caps every response at this project's ~1,000-row "Max
        // Rows" setting regardless of `.limit()`, so this has to be paged
        // through with fetchAllRows (see the same fix in dashboard/page.tsx).
        const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase.from(table).select("*").range(from, to),
        );
        rowsByTable[table] = rows.map(flatten);
      }),
    );
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Query failed", { status: 500 });
  }

  const folder = `full-export-${Date.now()}`;
  const links: Partial<Record<TableName, string>> = {};
  const storagePaths: Partial<Record<TableName, string>> = {};
  const rowCounts: Record<TableName, number> = { enrollee: 0, vaccination_status: 0, blood_smear: 0 };
  const expiresInSeconds = expiresHours * 3600;

  for (const table of TABLES) {
    const rows = rowsByTable[table];
    rowCounts[table] = rows.length;
    if (rows.length === 0) continue; // nothing to upload or link for an empty table

    const path = `${folder}/${table}.csv`;
    const csv = toCsv(rows);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv" });
    if (uploadError) {
      return new Response(`Upload failed for ${table}: ${uploadError.message}`, { status: 500 });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (signError || !signed) {
      return new Response(`Signing failed for ${table}: ${signError?.message ?? "unknown error"}`, {
        status: 500,
      });
    }
    links[table] = signed.signedUrl;
    storagePaths[table] = path;
  }

  // Date arithmetic is in milliseconds; expiresInSeconds is, as the name
  // says, seconds — createSignedUrl() above wants seconds directly, but this
  // needs the *1000 or it understates the expiry by 1000x (e.g. "48 hours"
  // logged and shown as under 3 minutes).
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const { error: logError } = await supabase.from("full_dataset_exports").insert({
    requested_by: user.email,
    storage_paths: storagePaths,
    row_counts: rowCounts,
    expires_at: expiresAt,
  });
  if (logError) {
    // The export itself succeeded and the links are live; failing to log it
    // shouldn't stop the admin from getting their data, but it does mean the
    // audit trail is incomplete for this one — worth surfacing, not silently
    // swallowing.
    console.error("full_dataset_exports insert failed:", logError.message);
  }

  return Response.json({ links, rowCounts, expiresAt, expiresHours });
}
