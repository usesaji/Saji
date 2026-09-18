/**
 * Revoke the current token. Ported from `AuthController::logout`.
 *
 * Revokes only the token that made this request, not every session, so logging
 * out on one device leaves the others signed in.
 */

import { bearerFromRequest, requireUser, revokeToken } from "@/server/auth";
import { handle, json } from "@/server/http";

export async function POST(request: Request) {
	return handle(async () => {
		await requireUser(request);

		const token = bearerFromRequest(request);
		if (token) await revokeToken(token);

		return json({ message: "Logged out." });
	});
}
