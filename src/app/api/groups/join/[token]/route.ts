/**
 * Join-by-invite-link: preview a circle, and join it.
 *
 * Ported from `GroupController::joinPreview` and `::joinByToken`.
 *
 * There is NO join-by-id path anywhere in the API. A user must hold the
 * unguessable invite token to enter a circle, which is what keeps private
 * circles private.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, notFound } from "@/server/http";
import { serializeMember } from "@/server/serializers";
import { emitAfterResponse } from "@/server/notifications";
import { publicFileUrl } from "@/server/storage";

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
			photo_url: publicFileUrl(group.photoUrl),
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
 *
 * NO interactive `$transaction` here on purpose. Supabase's pooled Postgres
 * (both the 6543 transaction-mode pooler AND, intermittently, the 5432
 * session-mode endpoint under load) can reject a transaction's opening `BEGIN`
 * with P2028 ("Unable to start a transaction in the given time"), which is
 * exactly what surfaced as a 500 here. The double-join race this was guarding
 * against is already closed at the DATABASE level by the
 * `@@unique([groupId, userId])` constraint on `group_members` — so instead of
 * an app-level lock, we attempt the create and treat a unique-constraint
 * violation (P2002) as "someone already joined", not an error.
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

		try {
			const member = group.autoApproveJoin
				? await createApprovedMember(group.id, user.id)
				: await prisma.groupMember.create({
						data: { groupId: group.id, userId: user.id, status: "pending" },
					});

			// Tell the ORGANIZER, not the joiner — the joiner just performed this
			// action and already sees the result. A pending request needs the
			// organizer to act, which is exactly the case that used to sit unseen
			// until they happened to open the group.
			emitAfterResponse({
				userId: group.organizerId,
				type: "join_requested",
				dedupeKey: `join_requested:${member.id}`,
				title: member.status === "approved"
					? `${user.name} joined ${group.name}`
					: `${user.name} wants to join ${group.name}`,
				body: member.status === "approved"
					? `${user.name} joined "${group.name}" through your invite link.`
					: `${user.name} asked to join "${group.name}". Approve or decline them from the group's requests page.`,
				href: member.status === "approved"
					? `/groups/${group.id}`
					: `/groups/${group.id}/requests`,
				meta: { group_id: String(group.id), group_name: group.name },
			});

			return json(serializeMember(member), 201);
		} catch (error) {
			// P2002: the unique (groupId, userId) constraint fired — a second
			// click on the link, or a genuine race with another request. Either
			// way the membership already exists; return it rather than erroring.
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				const existing = await prisma.groupMember.findUnique({
					where: { groupId_userId: { groupId: group.id, userId: user.id } },
				});

				if (existing) return json(serializeMember(existing), 200);
			}

			throw error;
		}
	});
}

/**
 * Create an approved member with the next free rotation position.
 *
 * The position is read then written as two separate statements rather than
 * inside a transaction, so under a genuine simultaneous double-join two
 * members could in theory land on the same `payoutPosition`. That is a cosmetic
 * ordering glitch (positions are re-sequenced later via the payout-order
 * screen), not a money-safety issue, and it is far rarer in practice than a
 * pooled connection failing to open a transaction at all — which is what was
 * turning every join attempt into a 500.
 */
async function createApprovedMember(groupId: bigint, userId: bigint) {
	const last = await prisma.groupMember.aggregate({
		where: { groupId },
		_max: { payoutPosition: true },
	});

	return prisma.groupMember.create({
		data: {
			groupId,
			userId,
			status: "approved",
			payoutPosition: (last._max.payoutPosition ?? 0) + 1,
			joinedAt: new Date(),
		},
	});
}
