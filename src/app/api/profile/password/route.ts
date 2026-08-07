/**
 * Password & Security: change password.
 *
 * Ported from `ProfileController::changePassword`.
 *
 * When the account already has a password the current one must be supplied and
 * correct. Google-only users (no password yet) can set one without a current
 * password — that is how they enable email/password login.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import {
	bearerFromRequest,
	hashPassword,
	requireUser,
	verifyPassword,
} from "@/server/auth";
import { createHash } from "node:crypto";
import { handle, json, parseBody, rateLimit, validationError } from "@/server/http";

const schema = z
	.object({
		current_password: z.string().optional(),
		password: z.string().min(8),
		password_confirmation: z.string().optional(),
	})
	.refine(
		(data) =>
			data.password_confirmation === undefined ||
			data.password === data.password_confirmation,
		{
			message: "The password confirmation does not match.",
			path: ["password"],
		},
	);

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		// Keyed by user, not IP: a stolen bearer token is what's actually being
		// brute-forced against `current_password` here, and that threat doesn't
		// need to come from one IP. Same budget as login's per-IP limit.
		rateLimit(`profile-password:${user.id}`, 6, 60);

		const data = await parseBody(request, schema);

		if (user.password) {
			if (!data.current_password) {
				throw validationError({
					current_password: ["The current password is required."],
				});
			}

			if (!(await verifyPassword(data.current_password, user.password))) {
				throw validationError({
					current_password: ["The current password is incorrect."],
				});
			}
		}

		await prisma.user.update({
			where: { id: user.id },
			data: { password: await hashPassword(data.password) },
		});

		// Security hygiene: revoke every OTHER token, so changing a password
		// logs out other sessions while keeping this one alive.
		const current = bearerFromRequest(request);
		const currentHash = current
			? createHash("sha256").update(current).digest("hex")
			: null;

		await prisma.accessToken.deleteMany({
			where: {
				userId: user.id,
				...(currentHash && { tokenHash: { not: currentHash } }),
			},
		});

		return json({ message: "Password updated." });
	});
}
