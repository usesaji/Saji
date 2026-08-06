/**
 * CORS for the API, replacing Laravel's `config/cors.php`.
 *
 * In Next 16 this file is `proxy.ts` — the `middleware` convention is
 * deprecated and renamed. It runs before any route handler, so preflight is
 * answered at the edge without waking a database connection.
 *
 * NOTE ON SCOPE: when frontend and API are the same deployment (the usual case
 * now), same-origin requests never trigger CORS at all and this is inert. It
 * exists for the split-origin case — a separately deployed frontend, or the dev
 * tunnels used for device testing.
 *
 * Credentials are NOT allowed, matching `supports_credentials => false` in the
 * Laravel config. Auth is bearer-token, so no cookie ever needs to ride along,
 * and refusing credentials keeps this immune to CSRF.
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * Allowed origins, comma-separated. Same env var name as the Laravel backend.
 * Empty means same-origin only, which is the correct default.
 */
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL ?? "")
	.split(",")
	.map((origin) => origin.trim().replace(/\/$/, ""))
	.filter(Boolean);

/** VS Code / GitHub dev tunnels, for testing on a real device. */
const TUNNEL_PATTERN = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.devtunnels\.ms$/;

function isAllowed(origin: string): boolean {
	if (ALLOWED_ORIGINS.includes(origin)) return true;
	if (TUNNEL_PATTERN.test(origin)) return true;

	// Any localhost port in development only. Never in production, where an
	// attacker-controlled page on localhost could otherwise read API responses.
	if (process.env.NODE_ENV !== "production") {
		return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
	}

	return false;
}

function corsHeaders(origin: string): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
		"Access-Control-Allow-Headers": "Authorization,Content-Type,Accept",
		// Echoing a specific origin makes the response vary by it; without this
		// a shared cache could serve one origin's response to another.
		Vary: "Origin",
	};
}

export function proxy(request: NextRequest) {
	const origin = request.headers.get("origin");

	// Same-origin request — no CORS involved.
	if (!origin) return NextResponse.next();

	if (!isAllowed(origin)) {
		// Answer without CORS headers; the browser blocks it. Returning 403
		// here would leak which origins are allowlisted.
		return request.method === "OPTIONS"
			? new NextResponse(null, { status: 204 })
			: NextResponse.next();
	}

	// Preflight: answer at the edge, no handler invoked.
	if (request.method === "OPTIONS") {
		return new NextResponse(null, {
			status: 204,
			headers: { ...corsHeaders(origin), "Access-Control-Max-Age": "86400" },
		});
	}

	const response = NextResponse.next();
	for (const [key, value] of Object.entries(corsHeaders(origin))) {
		response.headers.set(key, value);
	}

	return response;
}

export const config = {
	matcher: "/api/:path*",
};
