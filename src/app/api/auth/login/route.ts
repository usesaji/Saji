/**
 * Email + password login.
 *
 * Ported from `backend/app/Http/Controllers/Auth/AuthController.php::login`,
 * including the per-user account lockout from the Password & Security screen.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { createToken, verifyPassword } from "@/server/auth";
import {
	clientIp,
	handle,
	json,
	parseBody,
	rateLimit,
	validationError,
} from "@/server/http";
import { publicUser } from "@/server/serializers";

/** How long an account stays locked once the threshold is hit. */
const LOCKOUT_MINUTES = 15;

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

/**
 * One message for both "no such user" and "wrong password", so login cannot be
 * used to discover which addresses are registered.
 */
function rejectCredentials(): never {
	throw validationError({
		email: ["The provided credentials are incorrect."],
	});
}

export async function POST(request: Request) {
	return handle(async () => {
		rateLimit(`login:${clientIp(request)}`, 6, 60);

		const data = await parseBody(request, schema);

		const user = await prisma.user.findUnique({
			where: { email: data.email.toLowerCase() },
		});

		// While locked, reject even a correct password until the window passes.
		if (user?.lockedUntil && user.lockedUntil > new Date()) {
			throw validationError({
				email: ["This account is temporarily locked. Try again later."],
			});
		}

		const valid =
			user?.password && (await verifyPassword(data.password, user.password));

		if (!valid) {
			// Count the failure and lock once the user's configured threshold is
			// reached. A threshold of 0 disables the lockout entirely.
			if (user && user.lockAfterFailedAttempts > 0) {
				const attempts = user.failedLoginAttempts + 1;
				const lock = attempts >= user.lockAfterFailedAttempts;

				await prisma.user.update({
					where: { id: user.id },
					data: {
						failedLoginAttempts: lock ? 0 : attempts,
						lockedUntil: lock
							? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
							: user.lockedUntil,
					},
				});
			}

			rejectCredentials();
		}

		// A successful login clears the failure counter.
		if (user.failedLoginAttempts > 0 || user.lockedUntil) {
			await prisma.user.update({
				where: { id: user.id },
				data: { failedLoginAttempts: 0, lockedUntil: null },
			});
		}

		return json({
			user: publicUser(user),
			token: await createToken(user.id),
		});
	});
}
