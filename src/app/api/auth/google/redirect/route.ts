/**
 * Step 1 of Google sign-in: send the browser to Google's consent screen.
 *
 * Ported from `GoogleController::redirect`. This is a full-page navigation, not
 * a fetch — `api.auth.googleRedirectUrl()` puts it in an `<a href>` — so the
 * response must be a redirect and must never be JSON.
 */

import {
	authorizeUrl,
	createState,
	frontendUrl,
	stateCookie,
} from "@/server/oauth";

export async function GET(request: Request) {
	let location: string;
	let cookie: string | null = null;

	try {
		const state = createState();
		location = authorizeUrl(request, state);
		cookie = stateCookie(state);
	} catch {
		// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing. Bounce to login with
		// the same flag the callback uses, rather than rendering a stack trace
		// at a user who only clicked "Sign in with Google".
		location = frontendUrl(request, "/auth/login?error=google_not_configured");
	}

	const headers = new Headers({ Location: location });
	if (cookie) headers.append("Set-Cookie", cookie);

	return new Response(null, { status: 302, headers });
}
