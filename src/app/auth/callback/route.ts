import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth/PKCE callback. Used by the password-reset flow: Supabase emails a link
 * that lands here with a `code`; we exchange it for a session (recovery mode)
 * and forward to `next` (the set-new-password page). Also serves email
 * confirmation links. Public route (see middleware PUBLIC_PATHS: "/auth").
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Password reset is this route's only caller, so default there. Kept as a
  // param so the route can be reused (e.g. OAuth) by passing ?next=.
  const next = searchParams.get("next") ?? "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow same-origin relative redirects.
      const target = next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${target}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=reset`);
}
