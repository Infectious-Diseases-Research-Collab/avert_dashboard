import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Country, Profile } from "@/lib/types";

/**
 * Load the signed-in user's allowlist profile (country scope, locale, admin).
 * Returns null if not authenticated or not on the allowlist. Cached per request.
 *
 * Uses the get_my_profile() RPC (case-insensitive email match) rather than a
 * direct table query — allowed_users.email may be stored with mixed case, and
 * a plain equality match silently fails for a legitimate, allowlisted user
 * whose typed-at-signup email differs only in case from the stored row.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data } = await supabase.rpc("get_my_profile");
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Profile | null) ?? null;
});

/** Countries a profile is allowed to see. */
export function visibleCountries(profile: Profile): Country[] {
  if (profile.country_access === "BOTH") return ["UG", "BF"];
  return [profile.country_access];
}
