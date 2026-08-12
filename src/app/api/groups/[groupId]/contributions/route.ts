/**
 * Contributions for a group — list and record intent.
 *
 * Ported from `ContributionController::index` and `::store`.
 */

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json } from "@/server/http";
import {
	assertApprovedMember,
	assertVisible,
	findGroupOr404,
} from "@/server/groups";
import { serializeContribution } from "@/server/serializers";

/** Contributions the authenticated user has made to this group. */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		await assertVisible(group, user.id);

		const contributions = await prisma.contribution.findMany({
			where: { groupId: group.id, userId: user.id },
			orderBy: { createdAt: "desc" },
		});

		return json(contributions.map(serializeContribution));
	});
}

/**
 * Record a member's intent to contribute for the current cycle.
 *
 * Idempotent by construction: the unique index on (group, user, cycle) means a
 * double-submit returns the existing row rather than recording the same money
 * twice.
 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);

		// Rotating-circle contributions only. A challenge has no pooled
		// contribution — members save to their own wallets via the challenge
		// deposit endpoint instead.
		if (group.circleKind === "challenge") {
			throw new HttpError(
				422,
				"This is a savings challenge, not a rotating circle. Use the challenge deposit endpoint.",
			);
		}

		await assertApprovedMember(group, user.id);

		const existing = await prisma.contribution.findUnique({
			where: {
				groupId_userId_cycle: {
					groupId: group.id,
					userId: user.id,
					cycle: group.currentCycle,
				},
			},
		});

		const contribution =
			existing ??
			(await prisma.contribution.create({
				data: {
					groupId: group.id,
					userId: user.id,
					cycle: group.currentCycle,
					amount: group.contributionAmount,
					status: "pending",
				},
			}));

		// Non-custodial: the MEMBER's wallet signs the on-chain contribute, in the
		// browser, via the contract bindings. This endpoint's job is recording the
		// intent row; the chain decides whether it becomes `confirmed`, through
		// the indexer.
		//
		// The unsigned contribute XDR this used to build alongside was never read
		// by any caller — see the note in `POST /api/groups`.
		return json(
			{ contribution: serializeContribution(contribution) },
			existing ? 200 : 201,
		);
	});
}
