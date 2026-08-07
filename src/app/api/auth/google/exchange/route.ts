/**
 * Trade a Google-callback handoff code for the real bearer token.
 *
 * The callback route (`/api/auth/google/callback`) cannot return JSON — it's
 * a full-page redirect Google itself sends the browser to — so it puts a
 * short-lived, single-use CODE on the landing URL instead of the real 30-day
 * bearer token. This endpoint is how the frontend turns that code into the
 * actual token, over a POST body rather than a URL, so the long-lived
 * credential is never in the address bar, browser history, or a Referer
 * header.
 */

import { z } from "zod";
import { HttpError, handle, json, parseBody } from "@/server/http";
import { redeemHandoffCode } from "@/server/oauth";

const schema = z.object({
	code: z.string().min(1),
});

export async function POST(request: Request) {
	return handle(async () => {
		const data = await parseBody(request, schema);

		const token = await redeemHandoffCode(data.code);
		if (!token) {
			throw new HttpError(
				400,
				"That sign-in link has expired or was already used. Please sign in again.",
			);
		}

		return json({ token });
	});
}
