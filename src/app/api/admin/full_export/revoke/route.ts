import { createClient } from "@/lib/supabase/server";

const BUCKET = "exports";

/**
 * Revoke a full-dataset export before its natural expiry. A signed URL has
 * no revocation mechanism of its own — the token is self-contained and
 * stays valid until it expires — so the only way to invalidate one early is
 * to delete the object it points to. Once deleted, every link issued for
 * that export (there's one per table) starts returning an error, regardless
 * of how much time was left on it.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profileRows } = await supabase.rpc("get_my_profile");
  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
  if (!profile?.is_admin) return new Response("Forbidden", { status: 403 });

  let id: number | undefined;
  try {
    const body = await request.json();
    if (typeof body?.id === "number") id = body.id;
  } catch {
    // fall through to the missing-id response below
  }
  if (id == null) return new Response("Missing id", { status: 400 });

  const { data: row, error: fetchError } = await supabase
    .from("full_dataset_exports")
    .select("storage_paths,revoked_at")
    .eq("id", id)
    .single();
  if (fetchError || !row) return new Response("Export not found", { status: 404 });
  if (row.revoked_at) return Response.json({ ok: true }); // already revoked — idempotent

  const paths = Object.values(row.storage_paths as Record<string, string>);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      return new Response(`Failed to remove files: ${removeError.message}`, { status: 500 });
    }
  }

  const { error: updateError } = await supabase
    .from("full_dataset_exports")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    // Files are already gone (the link is dead either way) — the row just
    // won't show "revoked" in the history until this is retried.
    return new Response(`Files removed, but failed to record revocation: ${updateError.message}`, {
      status: 500,
    });
  }

  return Response.json({ ok: true });
}
