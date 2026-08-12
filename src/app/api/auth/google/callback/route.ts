/**
 * Step 2 of Google sign-in: Google redirects the user's BROWSER back here.
 *
 * Ported from `GoogleController::callback`.
 *
 * Because this is a full-page redirect rather than a fetch, we cannot return
 * JSON — the browser would simply display it. Instead we find-or-create the
 * user, mint a bearer token, and redirect into the app with a single-use
 * HANDOFF CODE on the URL — never the token itself (see `createHandoffCode`
 * in `@/server/oauth`). `src/app/auth/google/callback/page.tsx` immediately
 * trades that code for the real token over a POST body, then forwards to the
 * dashboard.
 */

import { prisma } from "@/server/db";
import {
	createHandoffCode,
	exchangeCode,
	frontendUrl,
	readStateCookie,
	stateCookie,
	verifyState,
} from "@/server/oauth";

/** Redirect back to login with a flag, clearing the one-time state cookie. */
function fail(request: Request, reason: string): Response {
	return new Response(null, {
		status: 302,
		headers: new Headers({
			Location: frontendUrl(request, `/auth/login?error=${reason}`),
			// Max-Age=0 expires it; a stale state must not survive to be replayed.
			"Set-Cookie": stateCookie("", 0),
		}),
	});
}

export async function GET(request: Request) {
	const url = new URL(request.url);

	// The user denied consent, or Google rejected the request outright.
	if (url.searchParams.get("error")) return fail(request, "google");

	const code = url.searchParams.get("code");
	if (!code) return fail(request, "google");

	if (!verifyState(url.searchParams.get("state"), readStateCookie(request))) {
		return fail(request, "google_state");
	}

	let profile;
	try {
		profile = await exchangeCode(request, code);
	} catch {
		// Bad code, misconfigured client, or Google unreachable.
		return fail(request, "google");
	}

	if (!profile.email) return fail(request, "google_no_email");

	// Emails are stored lowercase (see the login route), so match on the same
	// form or a returning Google user would create a second account.
	const email = profile.email.toLowerCase();

	// Resolve by google_id first (returning Google user), then fall back to
	// email so we LINK Google onto an account created by email signup instead
	// of inserting a duplicate email and hitting the unique constraint.
	const existing = await prisma.user.findFirst({
		where: { OR: [{ googleId: profile.id }, { email }] },
	});

	let user;

	if (existing) {
		// Link Google and mark verified. The user's own name and uploaded
		// avatar are deliberately left untouched.
		user = await prisma.user.update({
			where: { id: existing.id },
			data: {
				googleId: profile.id,
				// Google verifies the address, so trust it either way.
				emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
			},
		});
	} else {
		user = await prisma.user.create({
			data: {
				googleId: profile.id,
				email,
				name: profile.name ?? "Saji User",
				emailVerifiedAt: new Date(),
				// No password: this account can only sign in through Google until
				// the user sets one. The schema allows null for exactly this.
				password: null,
			},
		});
	}

	// No token is minted here. The handoff row records WHO the code is for; the
	// session itself is created at redemption, so nothing recoverable as a
	// credential is ever written to the database or placed on a URL.
	const handoffCode = await createHandoffCode(user.id);

	return new Response(null, {
		status: 302,
		headers: new Headers({
			Location: frontendUrl(
				request,
				`/auth/google/callback?code=${encodeURIComponent(handoffCode)}`,
			),
			"Set-Cookie": stateCookie("", 0),
		}),
	});
}
