import { createClient } from "@/lib/supabase/server";

/** Recent full-dataset export history, for the Admin section's audit view.
 * RLS on full_dataset_exports already restricts SELECT to admins, but the
 * explicit is_admin check gives a clean 403 instead of a silently empty
 * result for a non-admin caller. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profileRows } = await supabase.rpc("get_my_profile");
  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows;
  if (!profile?.is_admin) return new Response("Forbidden", { status: 403 });

  const { data, error } = await supabase
    .from("full_dataset_exports")
    .select("requested_by,row_counts,expires_at,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return new Response(error.message, { status: 500 });

  return Response.json({ exports: data ?? [] });
}
