/**
 * Profile — header and Personal Info.
 *
 * Ported from `ProfileController::show` and `::update`.
 *
 * Non-custodial reminder: nothing here touches keys or funds. The linked
 * Stellar address (public only) is surfaced read-only for reference.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody, validationError } from "@/server/http";

/** The Profile header + linked wallet reference. */
export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		return json({
			id: user.id,
			name: user.name,
			tag_name: user.tagName,
			email: user.email,
			avatar_url: user.avatarUrl,
			stellar_address: user.stellarAddress,
			date_of_birth: user.dateOfBirth?.toISOString().slice(0, 10) ?? null,
			gender: user.gender,
			address: user.address,
			// Google-only accounts have no password until they set one; this
			// drives whether the Password & Security screen asks for a current
			// password.
			has_password: Boolean(user.password),
			is_google_linked: Boolean(user.googleId),
			security: {
				twofa_on_suspicious_withdrawal: user.twofaOnSuspiciousWithdrawal,
				lock_after_failed_attempts: user.lockAfterFailedAttempts,
			},
		});
	});
}

const updateSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	tag_name: z
		.string()
		.min(1)
		.max(50)
		.regex(/^\S+$/, "Tag name cannot contain spaces.")
		.optional(),
	date_of_birth: z.string().date().nullish(),
	gender: z
		.enum(["male", "female", "other", "prefer_not_to_say"])
		.nullish(),
	address: z.string().max(255).nullish(),
});

/** Personal Info: update display name, public @tag, and optional details. */
export async function PATCH(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, updateSchema);

		if (data.tag_name !== undefined) {
			const taken = await prisma.user.findUnique({
				where: { tagName: data.tag_name },
			});
			// Reject a clash with a clean 422 rather than a DB-level 500.
			if (taken && taken.id !== user.id) {
				throw validationError({
					tag_name: ["That tag name is already taken."],
				});
			}
		}

		let dateOfBirth: Date | null | undefined;
		if (data.date_of_birth !== undefined) {
			dateOfBirth = data.date_of_birth ? new Date(data.date_of_birth) : null;

			if (dateOfBirth && dateOfBirth >= new Date()) {
				throw validationError({
					date_of_birth: ["Date of birth must be in the past."],
				});
			}
		}

		// Only assign keys the client actually sent, so a PATCH that omits a
		// field leaves it alone instead of nulling it.
		const updated = await prisma.user.update({
			where: { id: user.id },
			data: {
				...(data.name !== undefined && { name: data.name }),
				...(data.tag_name !== undefined && { tagName: data.tag_name }),
				...(dateOfBirth !== undefined && { dateOfBirth }),
				...(data.gender !== undefined && { gender: data.gender }),
				...(data.address !== undefined && { address: data.address }),
			},
		});

		return json({
			id: updated.id,
			name: updated.name,
			tag_name: updated.tagName,
			email: updated.email,
			avatar_url: updated.avatarUrl,
			stellar_address: updated.stellarAddress,
			date_of_birth: updated.dateOfBirth?.toISOString().slice(0, 10) ?? null,
			gender: updated.gender,
			address: updated.address,
		});
	});
}
