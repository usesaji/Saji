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

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** How long a signed `state` stays valid. Long enough to read a consent screen. */
const STATE_TTL_MS = 10 * 60_000;

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
	return new URL("/api/auth/google/callback", request.url).origin +
		"/api/auth/google/callback";
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

/** Constant-time verification of a `state` produced by `createState`. */
export function verifyState(state: string | null): boolean {
	if (!state) return false;

	const parts = state.split(".");
	if (parts.length !== 3) return false;

	const [nonce, expiry, mac] = parts;
	const expected = sign(`${nonce}.${expiry}`);

	// Length check first: timingSafeEqual throws on a length mismatch.
	if (mac.length !== expected.length) return false;
	if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;

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
