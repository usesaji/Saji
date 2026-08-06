/**
 * Join-by-invite-link: preview a circle, and join it.
 *
 * Ported from `GroupController::joinPreview` and `::joinByToken`.
 *
 * There is NO join-by-id path anywhere in the API. A user must hold the
 * unguessable invite token to enter a circle, which is what keeps private
 * circles private.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";

/**
 * Public-ish preview of what the invite leads to.
 *
 * Deliberately omits the member roster and any financial state — someone
 * holding a link should see the circle's rules well enough to decide, and
 * nothing about who is already in it.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	return handle(async () => {
		await requireUser(request);
		const { token } = await params;

		const group = await prisma.group.findUnique({
			where: { inviteToken: token },
			include: {
				_count: { select: { members: { where: { status: "approved" } } } },
			},
		});

		if (!group) throw notFound("Invite");

		return json({
			id: group.id,
			name: group.name,
			description: group.description,
			photo_url: group.photoUrl,
			target_amount: group.targetAmount,
			member_count: group._count.members,
			settings: {
				group_type: group.groupType,
				payout_order: group.payoutOrder,
				contribution_amount: group.contributionAmount,
				contribution_frequency: group.contributionFrequency,
				fee_bps: group.feeBps,
				late_fee_bps: group.lateFeeBps,
				grace_period_hours: group.gracePeriodHours,
				late_penalty: group.latePenalty,
				auto_approve_join: group.autoApproveJoin,
			},
		});
	});
}

/**
 * Join a group via its invite token.
 *
 * Honors the group rule: when `auto_approve_join` is on the member is admitted
 * immediately with a rotation position; otherwise they wait as 'pending' for
 * the organizer to accept them.
 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { token } = await params;

		const group = await prisma.group.findUnique({
			where: { inviteToken: token },
		});

		if (!group) throw notFound("Invite");

		const existing = await prisma.groupMember.findUnique({
			where: { groupId_userId: { groupId: group.id, userId: user.id } },
		});

		// Idempotent: a second click on the link returns the existing
		// membership rather than resetting an approved member to pending.
		if (existing) return json(existing, 200);

		const member = await prisma.$transaction(async (tx) => {
			if (!group.autoApproveJoin) {
				return tx.groupMember.create({
					data: { groupId: group.id, userId: user.id, status: "pending" },
				});
			}

			// Next free rotation position. Computed inside the transaction so
			// two simultaneous joins cannot claim the same slot.
			const last = await tx.groupMember.aggregate({
				where: { groupId: group.id },
				_max: { payoutPosition: true },
			});

			return tx.groupMember.create({
				data: {
					groupId: group.id,
					userId: user.id,
					status: "approved",
					payoutPosition: (last._max.payoutPosition ?? 0) + 1,
					joinedAt: new Date(),
				},
			});
		});

		return json(member, 201);
	});
}
