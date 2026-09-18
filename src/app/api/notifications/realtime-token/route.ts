/**
 * Mint a short-lived Supabase-compatible JWT so the browser can subscribe to
 * its OWN notification rows over Realtime.
 *
 * WHY THIS EXISTS. Saji does not use Supabase Auth — it has its own bearer
 * tokens (`AccessToken` + SHA-256). So there is no Supabase session, `auth.uid()`
 * is meaningless, and the row-level-security policy on `notifications` has
 * nothing to match against. This endpoint bridges that: the caller proves who
 * they are with a normal Saji token, and we hand back a JWT signed with the
 * project's own JWT secret carrying a `saji_user_id` claim. Postgres reads that
 * claim straight out of `request.jwt.claims` and the policy does the rest.
 *
 * The token grants exactly ONE capability: SELECT on that user's own rows. It
 * carries no Saji session, and the publishable key it is used alongside is
 * already public. Marking a notification read still goes through the
 * authenticated API — the browser has no write grant on the table.
 *
 * Short TTL because it cannot be revoked. The client refetches before expiry.
 */

import { createHmac } from "node:crypto";
import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";

/** Long enough not to churn, short enough that a leaked token ages out fast. */
const TTL_SECONDS = 60 * 60;

function base64url(input: string): string {
	return Buffer.from(input).toString("base64url");
}

/**
 * Minimal HS256 JWT. Hand-rolled rather than pulling in a JWT library for one
 * 20-line function — the same reasoning `mail.ts` applies to the Resend SDK.
 */
function signJwt(payload: Record<string, unknown>, secret: string): string {
	const body = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(
		JSON.stringify(payload),
	)}`;

	const signature = createHmac("sha256", secret).update(body).digest("base64url");
	return `${body}.${signature}`;
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		const secret = process.env.SUPABASE_JWT_SECRET ?? "";
		const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

		// NOT an error. Realtime is an enhancement: with it the bell updates the
		// instant a row lands, without it the client falls back to refreshing on
		// focus. Returning 500 here would surface a scary failure for a feature
		// that is simply not configured yet.
		if (!secret || !url) {
			return json({ enabled: false });
		}

		const issuedAt = Math.floor(Date.now() / 1000);

		return json({
			enabled: true,
			// Lets the client add a `user_id=eq.N` server-side filter. RLS already
			// guarantees isolation; this just avoids shipping rows to a browser
			// that would only discard them.
			user_id: String(user.id),
			token: signJwt(
				{
					// Supabase maps this claim to the Postgres role the connection
					// runs as, which is the role the RLS policy is written against.
					role: "authenticated",
					aud: "authenticated",
					sub: String(user.id),
					// What the policy actually compares. `sub` is conventionally a
					// UUID in Supabase-land and our ids are bigints, so this is kept
					// as its own unambiguous claim.
					saji_user_id: String(user.id),
					iat: issuedAt,
					exp: issuedAt + TTL_SECONDS,
				},
				secret,
			),
			expires_in: TTL_SECONDS,
		});
	});
}
