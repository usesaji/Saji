/**
 * Public savings challenges — browse and create.
 *
 * Ported from `PublicCircleController::index` and `::store`.
 *
 * A challenge is the OPEN counterpart to a closed rotating circle: a shared
 * savings goal, not a rotating pool. Anyone can browse and join, there is no
 * invite gate, no pooled escrow, no rotation, and no penalties. Each member
 * saves their OWN money toward the target; the circle provides accountability.
 * Non-custodial and entirely off-chain on our side — no contract involvement.
 */

import { z } from "zod";
import { prisma, withTransaction } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody, parseQuery } from "@/server/http";
import { serializeGroup } from "@/server/serializers";
import type { Prisma } from "@prisma/client";

const listSchema = z.object({
	q: z.string().max(100).optional(),
	per_page: z.coerce.number().int().min(1).max(50).default(20),
	page: z.coerce.number().int().min(1).default(1),
});

/** Browse open public challenges anyone can join. */
export async function GET(request: Request) {
	return handle(async () => {
		await requireUser(request);
		const params = parseQuery(request, listSchema);

		const where: Prisma.GroupWhereInput = {
			circleKind: "challenge",
			status: { in: ["open", "active"] },
			...(params.q && {
				name: { contains: params.q, mode: "insensitive" },
			}),
		};

		const [total, circles] = await Promise.all([
			prisma.group.count({ where }),
			prisma.group.findMany({
				where,
				include: {
					_count: { select: { members: { where: { status: "approved" } } } },
				},
				orderBy: { createdAt: "desc" },
				skip: (params.page - 1) * params.per_page,
				take: params.per_page,
			}),
		]);

		return json({
			data: circles.map((circle) => ({
				...serializeGroup(circle),
				member_count: circle._count.members,
			})),
			current_page: params.page,
			per_page: params.per_page,
			total,
			last_page: Math.max(1, Math.ceil(total / params.per_page)),
		});
	});
}

const createSchema = z.object({
	name: z.string().min(1).max(255),
	description: z.string().nullish(),
	photo_url: z.string().max(2048).nullish(),
	asset_code: z.string().max(12).nullish(),
	savings_target: z.union([
		z
			.string()
			.regex(/^\d+(\.\d{1,7})?$/, "Must be a number with at most 7 decimals"),
		z.number().positive(),
	]),
	challenge_ends_at: z.string().datetime().nullish(),
});

/**
 * Create a public savings challenge. Unlike a rotating circle, only a name, a
 * target, and optionally an end date are needed — no cycle, fees, penalties, or
 * payout order apply.
 */
export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, createSchema);

		const group = await withTransaction(async (tx) => {
			const created = await tx.group.create({
				data: {
					name: data.name,
					description: data.description ?? null,
					photoUrl: data.photo_url ?? null,
					organizerId: user.id,
					assetCode: data.asset_code ?? "USDC",
					// Not applicable to a challenge, but the columns are
					// non-null. Harmless defaults, so a challenge never carries
					// rotating semantics by accident.
					contributionAmount: "0",
					cycleLengthDays: 1,
					contributionFrequency: "custom",
					circleKind: "challenge",
					groupType: "public",
					savingsTarget: String(data.savings_target),
					challengeEndsAt: data.challenge_ends_at
						? new Date(data.challenge_ends_at)
						: null,
					// Open: anyone joins instantly, no approval step.
					autoApproveJoin: true,
					status: "open",
				},
			});

			// Creator is the first member. No rotation position applies.
			await tx.groupMember.create({
				data: {
					groupId: created.id,
					userId: user.id,
					status: "approved",
					joinedAt: new Date(),
				},
			});

			return created;
		});

		return json({ ...serializeGroup(group), member_count: 1 }, 201);
	});
}
