import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Country, Profile } from "@/lib/types";

/**
 * Load the signed-in user's allowlist profile (country scope, locale, admin).
 * Returns null if not authenticated or not on the allowlist. Cached per request.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data } = await supabase
    .from("allowed_users")
    .select("email, country_access, is_admin, default_locale, full_name")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  return (data as Profile | null) ?? null;
});

/** Countries a profile is allowed to see. */
export function visibleCountries(profile: Profile): Country[] {
  if (profile.country_access === "BOTH") return ["UG", "BF"];
  return [profile.country_access];
}
