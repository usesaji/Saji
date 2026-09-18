/**
 * Step 3 of signup — create the account.
 *
 * Ported from `backend/app/Http/Controllers/Auth/OtpController.php::completeProfile`.
 *
 * Requires the signup token from step 2, so the email on the new user is always
 * one that was actually verified. Without this check, step 3 would create an
 * account for any email an attacker typed and step 2 would be decorative.
 */

import { z } from "zod";
import { withTransaction } from "@/server/db";
import { createToken, hashPassword, hashSignupToken } from "@/server/auth";
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
		signup_token: z.string().min(1),
		name: z.string().min(1).max(255),
		tag_name: z
			.string()
			.min(1)
			.max(50)
			.regex(/^\S+$/, "Tag name cannot contain spaces."),
		password: z.string().min(8),
		password_confirmation: z.string().optional(),
	})
	// Laravel's `confirmed` rule. Only enforced when the client sends the field,
	// matching how the existing frontend posts this form.
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
		// `register/start` and `verify-otp` were both throttled; the step that
		// actually CREATES the account was not, leaving the only unthrottled
		// write in the signup chain.
		await rateLimit(`signup-complete:${clientIp(request)}`, 6, 60);

		const data = await parseBody(request, schema);

		const user = await withTransaction(async (tx) => {
			const otp = await tx.otpCode.findUnique({
				where: { signupTokenHash: hashSignupToken(data.signup_token) },
			});

			if (!otp || !otp.verifiedAt || otp.expiresAt < new Date()) {
				throw validationError({
					signup_token: ["Your verification has expired. Please start again."],
				});
			}

			// Guard the race between step 2 and step 3.
			if (await tx.user.findUnique({ where: { email: otp.email } })) {
				throw validationError({
					email: ["An account with that email already exists."],
				});
			}

			if (await tx.user.findUnique({ where: { tagName: data.tag_name } })) {
				throw validationError({
					tag_name: ["That tag name is already taken."],
				});
			}

			const created = await tx.user.create({
				data: {
					name: data.name,
					tagName: data.tag_name,
					email: otp.email,
					password: await hashPassword(data.password),
					emailVerifiedAt: new Date(),
				},
			});

			// Burn the token — one signup per verification.
			await tx.otpCode.delete({ where: { id: otp.id } });

			return created;
		});

		return json(
			{ user: publicUser(user), token: await createToken(user.id) },
			201,
		);
	});
}
