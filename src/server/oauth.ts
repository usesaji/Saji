/**
 * Google OAuth — the replacement for Laravel Socialite's `stateless()` flow.
 *
 * Ported from `backend/app/Http/Controllers/Auth/GoogleController.php`. Socialite
 * wrapped the endpoints, the token exchange, and the userinfo call; none of that
 * needs a dependency here, so this talks to Google's endpoints directly.
 *
 * "Stateless" in Socialite means the CSRF `state` parameter was not verified.
 * That is a real hole — without it an attacker can complete a consent flow in a
 * victim's browser and link accounts — so this version signs `state` and checks
 * it on the way back. See `createState` / `verifyState`.
 *
 * Sign-in is identity only. Saji is non-custodial: the user links a Stellar
 * wallet at deposit time and the backend never generates or holds one.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { pruneRateLimits } from "./http";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** How long a signed `state` stays valid. Long enough to read a consent screen. */
const STATE_TTL_MS = 10 * 60_000;

/** Cookie holding the signed `state`, compared against Google's echo. */
export const STATE_COOKIE = "saji_oauth_state";

/**
 * `Set-Cookie` value for the state cookie.
 *
 * HttpOnly because no script needs to read it. SameSite=Lax is required and
 * must not be tightened to Strict: Strict withholds the cookie on the
 * cross-site return from Google, which would fail every sign-in.
 */
export function stateCookie(state: string, maxAge = 600): string {
	const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

	return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Read the state cookie off the request. */
export function readStateCookie(request: Request): string | null {
	const header = request.headers.get("cookie");
	if (!header) return null;

	for (const part of header.split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name === STATE_COOKIE) return rest.join("=");
	}

	return null;
}

export type GoogleProfile = {
	id: string;
	email: string | null;
	name: string | null;
};

/**
 * Absolute base URL of the frontend.
 *
 * `FRONTEND_URL` may be a comma-separated list of dev origins; the first entry
 * is canonical, matching the Laravel helper this replaces. Falls back to the
 * request's own origin so a default dev setup needs no configuration.
 */
export function frontendUrl(request: Request, path: string): string {
	const configured = (process.env.FRONTEND_URL ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)[0];

	// Falling back to the request's own origin means trusting the Host header.
	// The OAuth success redirect carries the single-use handoff code, so a
	// spoofed Host behind a proxy that does not pin it sends that code — and the
	// session it redeems for — to an attacker's origin. In production this must
	// be configured; refusing to start is better than silently redirecting
	// somewhere unintended.
	if (!configured && process.env.NODE_ENV === "production") {
		throw new Error(
			"FRONTEND_URL is not set. It is required in production: the OAuth " +
				"redirect base must not be derived from the request's Host header.",
		);
	}

	const base = configured ?? new URL(request.url).origin;

	return base.replace(/\/$/, "") + path;
}

/**
 * The callback URL registered with Google.
 *
 * Derived from the incoming request rather than configured separately: it must
 * byte-match the "Authorized redirect URI" in the Google console, and deriving
 * it removes the chance of the two drifting apart.
 */
export function callbackUrl(request: Request): string {
	return new URL("/api/auth/google/callback", request.url).toString();
}

function stateSecret(): string {
	// Any server-side secret works; this one is already required in production.
	const secret = process.env.GOOGLE_CLIENT_SECRET;

	if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not set.");

	return secret;
}

function sign(payload: string): string {
	return createHmac("sha256", stateSecret()).update(payload).digest("hex");
}

/**
 * Build a signed, expiring `state` value.
 *
 * Format: `<nonce>.<expiry>.<hmac>`. Nothing secret is encoded — the point is
 * only that we can prove WE issued it, which is what defeats the CSRF.
 */
export function createState(): string {
	const payload = `${randomBytes(16).toString("hex")}.${Date.now() + STATE_TTL_MS}`;

	return `${payload}.${sign(payload)}`;
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
	// timingSafeEqual throws unless the buffers are the same length.
	if (a.length !== b.length) return false;

	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify the `state` Google echoed back.
 *
 * Two checks, and both matter. The signature proves we issued the value; the
 * cookie comparison proves it was issued to THIS browser. Checking only the
 * signature would still let an attacker paste their own valid state into a
 * victim's browser and link the victim's session to the attacker's Google
 * account — which is the login-CSRF that Socialite's `stateless()` allowed.
 */
export function verifyState(state: string | null, cookie: string | null): boolean {
	if (!state || !cookie) return false;
	if (!safeEqual(state, cookie)) return false;

	const parts = state.split(".");
	if (parts.length !== 3) return false;

	const [nonce, expiry, mac] = parts;

	if (!safeEqual(mac, sign(`${nonce}.${expiry}`))) return false;

	return Number(expiry) > Date.now();
}

/** Step 1: the Google consent URL to send the browser to. */
export function authorizeUrl(request: Request, state: string): string {
	const clientId = process.env.GOOGLE_CLIENT_ID;

	if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set.");

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callbackUrl(request),
		response_type: "code",
		scope: "openid email profile",
		state,
		// Google omits the email on repeat consents unless asked to re-prompt.
		prompt: "select_account",
	});

	return `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Step 2: exchange the one-time `code` for an access token, then read the
 * profile. Throws on any non-2xx so the caller can redirect to a friendly
 * error rather than leaking Google's response body.
 */
export async function exchangeCode(
	request: Request,
	code: string,
): Promise<GoogleProfile> {
	const clientId = process.env.GOOGLE_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

	if (!clientId || !clientSecret) {
		throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
	}

	const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: callbackUrl(request),
			grant_type: "authorization_code",
		}),
	});

	if (!tokenRes.ok) throw new Error("Google token exchange failed.");

	const { access_token: accessToken } = (await tokenRes.json()) as {
		access_token?: string;
	};

	if (!accessToken) throw new Error("Google returned no access token.");

	const profileRes = await fetch(GOOGLE_USERINFO_URL, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!profileRes.ok) throw new Error("Google userinfo request failed.");

	const profile = (await profileRes.json()) as {
		sub?: string;
		email?: string;
		email_verified?: boolean;
		name?: string;
	};

	if (!profile.sub) throw new Error("Google returned no subject id.");

	return {
		id: profile.sub,
		// Only trust a VERIFIED address. An unverified one could be any address
		// the account holder typed, and we match existing users on email — so
		// accepting it would let someone claim another person's Saji account.
		email: profile.email_verified ? (profile.email ?? null) : null,
		name: profile.name ?? null,
	};
}

// ---------------------------------------------------------------------------
// Handoff code — trades a URL-safe redirect for a real bearer token
//
// The callback is a full-page redirect, so it cannot return the bearer token
// as JSON — but putting the real 30-day token directly on the URL leaves it
// in browser history and exposed to anything that reads `window.location` or
// fires a request before the landing page can clear it. Instead the callback
// mints a single-use, 30-second CODE and puts that on the URL; the frontend
// immediately exchanges it for the real token via a POST body (never a URL),
// mirroring the signup-token pattern used elsewhere in the OTP flow. A code
// that is never redeemed is worthless after it expires.
//
// Stored in the DB (OauthHandoff), not an in-memory Map: the callback and the
// exchange are two separate requests with no guarantee of landing on the same
// serverless instance.
// ---------------------------------------------------------------------------

const HANDOFF_TTL_MS = 30_000;

/**
 * Mint a one-time code that redeems for a session for `userId`, within 30s.
 *
 * Takes a USER, not a token. The row used to carry the real 30-day bearer token
 * in plaintext, so the table was a list of live credentials sitting next to a
 * carefully-hashed code. The token cannot be hashed (it has to be handed back),
 * so it is no longer stored — `redeemHandoffCode` mints a fresh one instead.
 */
export async function createHandoffCode(userId: bigint): Promise<string> {
	const code = randomBytes(32).toString("hex");

	await prisma.oauthHandoff.create({
		data: {
			codeHash: hashHandoffCode(code),
			userId,
			expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
		},
	});

	return code;
}

function hashHandoffCode(code: string): string {
	return createHash("sha256").update(code).digest("hex");
}

/**
 * Redeem a handoff code for the bearer token it was minted for, or null if
 * the code is unknown, already used, or expired. Single-use: the row is
 * deleted whether or not it was valid, so a code can never be replayed.
 */
export async function redeemHandoffCode(code: string): Promise<bigint | null> {
	const codeHash = hashHandoffCode(code);

	// Delete-and-return in one round trip: two concurrent redemption attempts
	// (e.g. a double-fired effect on the landing page) can only have one of
	// them find the row, so the code is inherently single-use even under a
	// race, not just "single-use in the common case."
	const deleted = await prisma.oauthHandoff
		.delete({ where: { codeHash } })
		.catch(() => null);

	if (!deleted || deleted.expiresAt < new Date()) return null;
	return deleted.userId;
}

/**
 * Delete lapsed handoff rows and rate-limit buckets.
 *
 * Neither table had a cleaner. Handoff codes live 30 seconds, but a row is only
 * removed when it is REDEEMED — so every abandoned sign-in (closed tab, dropped
 * network) left one behind permanently. The `@@index([expiresAt])` was clearly
 * added for a sweeper that was never written.
 */
export async function sweepExpired(): Promise<{
	expired_handoffs_swept: number;
	expired_rate_limits_swept: number;
}> {
	const now = new Date();

	const [handoffs, rateLimits] = await Promise.all([
		prisma.oauthHandoff.deleteMany({ where: { expiresAt: { lt: now } } }),
		pruneRateLimits(),
	]);

	return {
		expired_handoffs_swept: handoffs.count,
		expired_rate_limits_swept: rateLimits,
	};
}
