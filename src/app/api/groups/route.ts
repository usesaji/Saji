/**
 * Groups — list and create.
 *
 * Ported from `GroupController::index` and `::store`.
 */

import { z } from "zod";
import { prisma, withTransaction } from "@/server/db";
import { requireUser, generateInviteToken } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";
import {
	LATE_PENALTY_VARIANT,
	PAYOUT_ORDER_VARIANT,
	cycleLengthFromFrequency,
	tokenSac,
} from "@/server/groups";
import { buildCreateGroupTx, toStroops } from "@/server/stellar/service";
import { serializeGroupWithCount, serializeGroup } from "@/server/serializers";

/** Groups the authenticated user organizes or belongs to. */
export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		const groups = await prisma.group.findMany({
			where: {
				OR: [
					{ organizerId: user.id },
					{ members: { some: { userId: user.id } } },
				],
			},
			include: { _count: { select: { members: true } } },
			orderBy: { createdAt: "desc" },
		});

		return json(
			groups.map((group) => serializeGroupWithCount(group, group._count.members)),
		);
	});
}

const decimal = z
	.string()
	.regex(/^\d+(\.\d{1,7})?$/, "Must be a number with at most 7 decimal places");

/**
 * Amounts are accepted as strings, not numbers. JSON numbers are IEEE-754
 * doubles and cannot represent every 7-dp decimal exactly; the error would land
 * straight in a contribution amount.
 */
const createSchema = z
	.object({
		name: z.string().min(1).max(255),
		description: z.string().nullish(),
		photo_url: z.string().max(2048).nullish(),
		asset_code: z.string().max(12).nullish(),
		contribution_amount: z.union([decimal, z.number().positive()]),
		target_amount: z.union([decimal, z.number().positive()]).nullish(),
		contribution_frequency: z.enum([
			"daily",
			"weekly",
			"bi_weekly",
			"monthly",
			"custom",
		]),
		cycle_length_days: z.number().int().min(1).max(365).nullish(),
		fee_bps: z.number().int().min(0).max(10000).nullish(),
		late_fee_bps: z.number().int().min(0).max(10000).nullish(),
		grace_period_hours: z.number().int().min(0).max(8760).nullish(),
		late_penalty: z.enum(["deduct_from_balance", "remove_member"]).nullish(),
		payout_order: z.enum(["random", "manual", "vote", "custom"]).nullish(),
		group_type: z.enum(["public", "private"]).nullish(),
		auto_approve_join: z.boolean().nullish(),
		hide_balances: z.boolean().nullish(),
	})
	// Laravel's `required_if:contribution_frequency,custom`.
	.refine(
		(data) =>
			data.contribution_frequency !== "custom" || data.cycle_length_days != null,
		{
			message: "Cycle length is required for a custom frequency.",
			path: ["cycle_length_days"],
		},
	);

/**
 * Create a savings group. The organizer is auto-enrolled as member #1.
 *
 * The group starts in 'draft' with no onchain_group_id until the organizer
 * signs create_group. The unsigned XDR for that is returned here when we can
 * build it.
 */
export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, createSchema);

		const cycleLengthDays = cycleLengthFromFrequency(
			data.contribution_frequency,
			data.cycle_length_days,
		);

		const group = await withTransaction(async (tx) => {
			const created = await tx.group.create({
				data: {
					name: data.name,
					description: data.description ?? null,
					photoUrl: data.photo_url ?? null,
					organizerId: user.id,
					assetCode: data.asset_code ?? "USDC",
					contributionAmount: String(data.contribution_amount),
					targetAmount:
						data.target_amount != null ? String(data.target_amount) : null,
					cycleLengthDays,
					contributionFrequency: data.contribution_frequency,
					feeBps: data.fee_bps ?? 0,
					lateFeeBps: data.late_fee_bps ?? 0,
					gracePeriodHours: data.grace_period_hours ?? 0,
					latePenalty: data.late_penalty ?? "deduct_from_balance",
					payoutOrder: data.payout_order ?? "manual",
					groupType: data.group_type ?? "private",
					autoApproveJoin: data.auto_approve_join ?? false,
					hideBalances: data.hide_balances ?? false,
					inviteToken: generateInviteToken(),
					status: "draft",
				},
			});

			// Organizer is member #1 and pre-approved.
			await tx.groupMember.create({
				data: {
					groupId: created.id,
					userId: user.id,
					status: "approved",
					payoutPosition: 1,
					joinedAt: new Date(),
				},
			});

			return created;
		});

		// Non-custodial: we cannot create the group on-chain ourselves — the
		// organizer's wallet must sign. Build the unsigned tx if we can.
		//
		// Best-effort by design: the frontend now creates the group on-chain
		// directly via the contract bindings and reports the id back via
		// PATCH .../onchain, so this XDR is a convenience. An RPC failure must
		// never 500 the create — the DB row still has to be returned.
		let unsignedXdr: string | null = null;
		const token = tokenSac(group);

		if (user.stellarAddress && token) {
			try {
				unsignedXdr = await buildCreateGroupTx({
					organizer: user.stellarAddress,
					token,
					contributionAmount: toStroops(String(data.contribution_amount)),
					cycleLengthDays,
					feeBps: data.fee_bps ?? 0,
					lateFeeBps: data.late_fee_bps ?? 0,
					gracePeriodHours: data.grace_period_hours ?? 0,
					payoutOrder: PAYOUT_ORDER_VARIANT[data.payout_order ?? "manual"],
					latePenalty:
						LATE_PENALTY_VARIANT[data.late_penalty ?? "deduct_from_balance"],
				});
			} catch (error) {
				console.warn("[groups] could not build create_group XDR:", error);
			}
		}

		return json({ group: serializeGroup(group), unsigned_xdr: unsignedXdr }, 201);
	});
}
