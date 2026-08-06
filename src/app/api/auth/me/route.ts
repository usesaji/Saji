/** The authenticated user. Ported from `AuthController::me`. */

import { requireUser } from "@/server/auth";
import { handle, json } from "@/server/http";
import { publicUser } from "@/server/serializers";

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		return json(publicUser(user));
	});
}
