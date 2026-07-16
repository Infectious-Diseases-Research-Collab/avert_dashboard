import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Refresh the Supabase session cookie and guard protected routes.
 *
 * "Allowed" means both a valid Supabase Auth session AND a matching
 * allowed_users row (via get_my_profile(), case-insensitive) — not just a
 * session. Deciding this once, here, is what prevents a redirect loop: if
 * /login and /dashboard each independently decided "logged in enough for
 * me?" using different definitions (raw session vs. allowlist profile),
 * a session-without-profile user (a case-mismatched email, or someone
 * removed from allowed_users after they'd already signed up) would bounce
 * between them forever — /dashboard sends them to /login for having no
 * profile, /login sends them straight back for having a session. Session-
 * without-profile is fully signed out here instead, landing cleanly on the
 * login form.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let allowed = false;
  if (user) {
    const { data } = await supabase.rpc("get_my_profile");
    allowed = Array.isArray(data) ? data.length > 0 : !!data;
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // signOut() mutates cookies via the same setAll wiring above, which
  // reassigns `response` each time — build the redirect from that latest
  // `response` (carrying its Set-Cookie headers) rather than a bare
  // NextResponse.redirect(), or a signed-out user's cleared session
  // wouldn't actually take effect in the browser.
  function redirectTo(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  if (!allowed && !isPublic) {
    if (user) await supabase.auth.signOut();
    return redirectTo("/login");
  }

  if (allowed && path === "/login") {
    return redirectTo("/dashboard");
  }

  return response;
}
