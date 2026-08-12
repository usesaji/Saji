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
	MAX_CYCLE_SECONDS,
	MIN_CYCLE_SECONDS,
	cycleLengthFromFrequency,
} from "@/server/groups";
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
			include: {
				_count: { select: { members: true } },
				// A few real faces for the card's avatar stack. The card used to
				// render a single static PNG with four strangers and "+12" baked
				// into the image, which contradicted the member count printed
				// directly beneath it.
				members: {
					where: { status: "approved" },
					orderBy: { payoutPosition: "asc" },
					take: 4,
					select: { user: { select: { name: true, avatarUrl: true } } },
				},
			},
			orderBy: { createdAt: "desc" },
		});

		// Two grouped queries for ALL the cards at once, rather than a pair per
		// card. Skipped entirely when the user has no groups — an empty `OR` is
		// an unnecessary round trip and a needless edge case.
		const ids = groups.map((group) => group.id);

		const [collected, approved, paidThisCycle] = ids.length
			? await Promise.all([
					// THE VIEWER's cumulative confirmed contributions per group.
					//
					// Matches `user_progress.paid` on the circle detail page, so the
					// card and the page it opens can never disagree. CONFIRMED only:
					// a pending row is an intent, and counting it would show savings
					// the chain has never seen.
					prisma.contribution.groupBy({
						by: ["groupId"],
						where: { status: "confirmed", userId: user.id, groupId: { in: ids } },
						_sum: { amount: true },
					}),
					// APPROVED members, which is what sizes the pot — pending
					// requesters owe nothing and receive nothing. Counted separately
					// from `_count.members` (every status) because the two answer
					// different questions, and from the `members` relation above,
					// which is capped at 4 for avatars and is not a count at all.
					prisma.groupMember.groupBy({
						by: ["groupId"],
						where: { status: "approved", groupId: { in: ids } },
						_count: { _all: true },
					}),
					// Which groups the viewer has already paid for THIS cycle —
					// what the PAID/PENDING badge actually means to a member.
					prisma.contribution.findMany({
						where: {
							status: "confirmed",
							userId: user.id,
							OR: groups.map((group) => ({
								groupId: group.id,
								cycle: group.currentCycle,
							})),
						},
						select: { groupId: true },
					}),
				])
			: [[], [], []];

		const paidByGroup = new Map(
			collected.map((row) => [row.groupId, row._sum.amount?.toString() ?? "0"]),
		);
		const approvedByGroup = new Map(
			approved.map((row) => [row.groupId, row._count._all]),
		);
		const settledThisCycle = new Set(
			paidThisCycle.map((row) => row.groupId.toString()),
		);

		return json(
			groups.map((group) =>
				serializeGroupWithCount(group, group._count.members, {
					youPaidTotal: paidByGroup.get(group.id) ?? "0",
					youPaidThisCycle: settledThisCycle.has(group.id.toString()),
					approvedCount: approvedByGroup.get(group.id) ?? 0,
					memberAvatars: group.members.map((member) => ({
						name: member.user.name,
						avatar_url: member.user.avatarUrl,
					})),
				}),
			),
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
			"hourly",
			"six_hourly",
			"daily",
			"two_daily",
			"weekly",
			"bi_weekly",
			"monthly",
			"quarterly",
			"yearly",
			"custom",
		]),
		// SECONDS, matching the contract. Bounds mirror the contract's own
		// MIN_CYCLE_LENGTH/MAX_CYCLE_LENGTH so an out-of-range value is rejected
		// here with a field error instead of reverting on-chain after the user
		// has already signed.
		cycle_length_seconds: z
			.number()
			.int()
			.min(MIN_CYCLE_SECONDS)
			.max(MAX_CYCLE_SECONDS)
			.nullish(),
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
			data.contribution_frequency !== "custom" ||
			data.cycle_length_seconds != null,
		{
			message: "Cycle length is required for a custom frequency.",
			path: ["cycle_length_seconds"],
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

		const cycleLengthSeconds = cycleLengthFromFrequency(
			data.contribution_frequency,
			data.cycle_length_seconds,
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
					cycleLengthSeconds,
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

		// Non-custodial: the group is created on-chain by the ORGANIZER'S WALLET,
		// in the browser, via the generated contract bindings — then reported back
		// with PATCH .../onchain. This route is the off-chain half only.
		//
		// It used to also build an unsigned create_group XDR here as a
		// "convenience". Nothing ever consumed it: two RPC round trips
		// (getAccount + prepareTransaction) on the critical path of every group
		// creation, discarded on arrival. Worse, being unexercised it had drifted
		// out of agreement with the contract — it passed cycle length in DAYS and
		// grace period in HOURS as u32, where the contract takes SECONDS as u64 —
		// so had anything started using it, it would have failed. Two encodings of
		// one contract interface is how that happens; there is now one, in
		// `src/lib/hooks/useSavingsContract.ts`.
		return json({ group: serializeGroup(group) }, 201);
	});
}
