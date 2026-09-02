/**
 * TEMPORARY diagnostic route — confirms which contract production resolves
 * to. Delete after use.
 */

import { handle, json } from "@/server/http";
import { safeEqual } from "@/server/auth";
import { CONTRACT_ID, getGroup } from "@/server/stellar/service";

export async function GET(request: Request) {
	return handle(async () => {
		const secret = process.env.CRON_SECRET ?? "";
		const header = request.headers.get("authorization") ?? "";
		const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
		if (!secret || !provided || !safeEqual(provided, secret)) {
			return new Response("Unauthorized", { status: 401 });
		}

		const EXPECTED = "CA3UA2T54JV4OCIKNTMBRNZFZFV6I4PYCWWZ4REY7LH4S7VGXIMPLXNH";

		let group17Ok = false;
		let group17Error: string | null = null;
		try {
			await getGroup(7n);
			group17Ok = true;
		} catch (e) {
			group17Error = String(e);
		}

		return json({
			resolved_contract_id: CONTRACT_ID,
			matches_expected: CONTRACT_ID === EXPECTED,
			group_17_onchain_read: group17Ok ? "success" : "failed",
			group_17_error: group17Error,
		});
	});
}
