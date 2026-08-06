/**
 * Single-shot registration (name + email + password).
 *
 * Ported from `AuthController::register`. Kept for API clients that don't use
 * the multi-step OTP flow; the app itself uses `/auth/register/start`.
 *
 * Saji is non-custodial: sign-in establishes identity only. The user's Stellar
 * wallet is connected at deposit time and never held by the backend, so no
 * wallet address is generated or stored here.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { createToken, hashPassword } from "@/server/auth";
import {
	clientIp,
	handle,
	json,
	parseBody,
	rateLimit,
	validationError,
} from "@/server/http";
import { publicUser } from "@/server/serializers";

const schema = z
	.object({
		name: z.string().min(1).max(255),
		email: z.string().email().max(255),
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
		rateLimit(`register:${clientIp(request)}`, 6, 60);

		const data = await parseBody(request, schema);
		const email = data.email.toLowerCase();

		if (await prisma.user.findUnique({ where: { email } })) {
			throw validationError({ email: ["That email is already registered."] });
		}

		const user = await prisma.user.create({
			data: {
				name: data.name,
				email,
				password: await hashPassword(data.password),
			},
		});

		return json(
			{ user: publicUser(user), token: await createToken(user.id) },
			201,
		);
	});
}
