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
import { buildContributeTx } from "@/server/stellar/service";

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

		return json(contributions);
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

		// Non-custodial: the MEMBER's wallet signs the on-chain contribute.
		//
		// Best-effort. The frontend now settles on-chain directly via the
		// contract bindings, so this endpoint's real job is recording the intent
		// row. If the build fails we still return the contribution rather than
		// 500, and the frontend proceeds with its own signing.
		let unsignedXdr: string | null = null;

		if (user.stellarAddress && group.onchainGroupId !== null) {
			try {
				unsignedXdr = await buildContributeTx(
					user.stellarAddress,
					group.onchainGroupId,
				);
			} catch (error) {
				console.warn("[contributions] could not build contribute XDR:", error);
			}
		}

		return json(
			{ contribution, unsigned_xdr: unsignedXdr },
			existing ? 200 : 201,
		);
	});
}
