/**
 * TEMPORARY diagnostic route — not part of the app. Isolates which specific
 * on-chain read is causing the indexer's persistent `read_failures: 2`.
 * Delete after use.
 */

import { prisma } from "@/server/db";
import { handle, json } from "@/server/http";
import { safeEqual } from "@/server/auth";
import { getGroup, getMembers, depositsOpenAt, isRemoved } from "@/server/stellar/service";

const STATUS_MAP = ["draft", "open", "active", "completed"] as const;

export async function GET(request: Request) {
	return handle(async () => {
		// Reuses CRON_SECRET rather than a new var — this route exposes group
		// names/addresses and is only ever meant to be hit manually while
		// debugging, same trust level as the cron route.
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
					const opensAt = await depositsOpenAt(onchainId);
					entry.deposits_open_at = opensAt;
				}
			} catch (e) {
				entry.deposits_open_at_error = String(e);
			}

			let members: string[] = [];
			try {
				members = await getMembers(onchainId);
				entry.member_count = members.length;
			} catch (e) {
				entry.get_members_error = String(e);
			}

			const removedErrors: Record<string, string> = {};
			for (const address of members) {
				try {
					await isRemoved(onchainId, address);
				} catch (e) {
					removedErrors[address] = String(e);
				}
			}
			if (Object.keys(removedErrors).length > 0) {
				entry.is_removed_errors = removedErrors;
			}

			results.push(entry);
		}

		return json({ results });
	});
}
