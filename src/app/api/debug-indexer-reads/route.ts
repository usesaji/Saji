/**
 * TEMPORARY diagnostic route — not part of the app. Confirms which contract
 * address production is actually reading from. Delete after use.
 */

import { prisma } from "@/server/db";
import { handle, json } from "@/server/http";
import { safeEqual } from "@/server/auth";
import { CONTRACT_ID, getGroup, getMembers, depositsOpenAt } from "@/server/stellar/service";

const STATUS_MAP = ["draft", "open", "active", "completed"] as const;

export async function GET(request: Request) {
	return handle(async () => {
		const secret = process.env.CRON_SECRET ?? "";
		const header = request.headers.get("authorization") ?? "";
		const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
		if (!secret || !provided || !safeEqual(provided, secret)) {
			return new Response("Unauthorized", { status: 401 });
		}

		const groups = await prisma.group.findMany({
			where: { onchainGroupId: { not: null } },
			select: { id: true, name: true, onchainGroupId: true },
		});

		const results = [];

		for (const g of groups) {
			const onchainId = g.onchainGroupId!;
			const entry: Record<string, unknown> = {
				db_group_id: g.id.toString(),
				name: g.name,
				onchain_group_id: onchainId.toString(),
			};

			try {
				const state = await getGroup(onchainId);
				entry.status = STATUS_MAP[state.status] ?? "open";
			} catch (e) {
				entry.get_group_error = String(e);
				results.push(entry);
				continue;
			}

			try {
				if (entry.status === "active") {
					entry.deposits_open_at = await depositsOpenAt(onchainId);
				}
			} catch (e) {
				entry.deposits_open_at_error = String(e);
			}

			try {
				entry.member_count = (await getMembers(onchainId)).length;
			} catch (e) {
				entry.get_members_error = String(e);
			}

			results.push(entry);
		}

		return json({
			resolved_contract_id: CONTRACT_ID,
			env_stellar_contract_id: process.env.STELLAR_CONTRACT_ID ?? "(unset)",
			env_public_savings_contract_id:
				process.env.NEXT_PUBLIC_SAVINGS_CONTRACT_ID ?? "(unset)",
			results,
		});
	});
}
